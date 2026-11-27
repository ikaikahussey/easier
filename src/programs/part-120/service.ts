import { randomInt, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { OrgVault } from "@/core/crypto";
import { isIsoDate } from "@/core/dates";
import { withTenant, type Tx } from "@/core/db/client";
import { memberships, organizations, p120Log, p120Programs, p120Records, users } from "@/core/db/schema";
import { ForbiddenError, NotFoundError, principal, ValidationError, vaultFor, type Actor } from "@/core/services/context";
import {
  clearance,
  collectionProblem,
  functionNames,
  misCounts,
  planDraw,
  quarterOf,
  todayIn,
  zonedToUtc,
} from "./rules";
import { TERMS, termsHash } from "./terms";
import {
  FUNCTIONS,
  OPERATIONS,
  TEST_REASONS,
  TIME_ZONES,
  type Contractor,
  type Coverage,
  type Draw,
  type FunctionCode,
  type Incident,
  type IsoDate,
  type MisFiling,
  type Operation,
  type Person,
  type Program,
  type RecordKind,
  type State,
  type Substance,
  type Test,
  type TestReason,
  type TestResult,
  type TrainingKind,
  type WithId,
} from "./types";

/** The clearance gate refused a duty assignment. */
export class ClearanceError extends ForbiddenError {
  constructor(readonly blockers: string[]) {
    super(`Duty assignment blocked. ${blockers.join(". ")}.`);
  }
}

export const part120Enabled = (env: NodeJS.ProcessEnv = process.env) => env.P120_ENABLED === "1";

const programOf = (r: typeof p120Programs.$inferSelect): Program => ({
  orgId: r.orgId,
  operation: r.operation as Operation,
  registrationKind: r.registrationKind as Program["registrationKind"],
  registrationRef: r.registrationRef,
  derUserId: r.derUserId,
  timeZone: r.timeZone,
  misNotified: r.misNotified,
  termsHash: r.termsHash ?? undefined,
  termsSigner: r.termsSigner ?? undefined,
  termsAcceptedAt: r.termsAcceptedAt?.toISOString(),
});

/** True when the employer has accepted the terms text currently in force. */
export const termsCurrent = (p: Program) => p.termsHash === termsHash();

const context = (kind: string, id: string) => `p120:${kind}:${id}`;

async function loadState(tx: Tx, vault: OrgVault, program: Program): Promise<State> {
  const rows = await tx.select().from(p120Records).where(eq(p120Records.orgId, program.orgId)).orderBy(p120Records.createdAt, p120Records.id);
  const state: State = { program, people: [], tests: [], draws: [], incidents: [], contractors: [], filings: [] };
  const bucket: Record<RecordKind, { id: string }[]> = {
    person: state.people,
    test: state.tests,
    draw: state.draws,
    incident: state.incidents,
    contractor: state.contractors,
    filing: state.filings,
  };
  for (const r of rows) bucket[r.kind as RecordKind]?.push({ ...vault.open<object>(r.dataEnc, context(r.kind, r.id)), id: r.id });
  return state;
}

interface Ctx {
  tx: Tx;
  state: State;
  today: IsoDate;
  now: Date;
  create: <T extends object>(kind: RecordKind, data: T, id?: string) => Promise<string>;
  save: <T extends { id: string }>(kind: RecordKind, row: T) => Promise<void>;
  log: (type: string, payload?: unknown) => Promise<void>;
}

function assertClient(actor: Actor) {
  if (actor.role !== "client") throw new ForbiddenError("Only the employer's own people can open its Part 120 program");
}

/**
 * Run inside the tenant transaction with the decrypted program state. Row-level security
 * scopes every statement to the actor's organizations. Nothing runs until the employer has
 * accepted the terms currently in force.
 */
async function run<T>(actor: Actor, orgId: string, now: Date, fn: (c: Ctx) => Promise<T>): Promise<T> {
  assertClient(actor);
  return withTenant(principal(actor), async (tx) => {
    const [row] = await tx.select().from(p120Programs).where(eq(p120Programs.orgId, orgId));
    if (!row) throw new NotFoundError("Part 120 program not found");
    const vault = await vaultFor(tx, orgId);
    const program = programOf(row);
    if (!termsCurrent(program)) throw new ForbiddenError("Your designated employer representative must accept the current Part 120 terms before the desk can be used");
    const state = await loadState(tx, vault, program);
    const c: Ctx = {
      tx,
      state,
      now,
      today: todayIn(program.timeZone, now),
      async create(kind, data, id = randomUUID()) {
        await tx.insert(p120Records).values({ id, orgId, kind, dataEnc: vault.seal(data, context(kind, id)) });
        return id;
      },
      async save(kind, row) {
        const { id, ...data } = row;
        const updated = await tx
          .update(p120Records)
          .set({ dataEnc: vault.seal(data, context(kind, id)), updatedAt: now })
          .where(and(eq(p120Records.id, id), eq(p120Records.orgId, orgId), eq(p120Records.kind, kind)))
          .returning({ id: p120Records.id });
        if (!updated.length) throw new NotFoundError();
      },
      async log(type, payload) {
        const id = randomUUID();
        await tx.insert(p120Log).values({ id, orgId, actorId: actor.id, type, payloadEnc: payload === undefined ? null : vault.seal(payload, context("log", id)) });
      },
    };
    return fn(c);
  });
}

// ── Input checks ─────────────────────────────────────────────────────────────

const fail = (...issues: string[]): never => {
  throw new ValidationError(issues);
};
const text = (v: string | undefined, label: string, max = 200) => {
  const s = (v ?? "").trim();
  if (!s) fail(`${label} is required`);
  if (s.length > max) fail(`${label} is too long`);
  return s;
};
const date = (v: string | undefined, label: string, today: IsoDate): IsoDate => {
  const s = (v ?? "").trim();
  if (!isIsoDate(s)) fail(`${label} must be a date`);
  if (s > today) fail(`${label} cannot be in the future`);
  return s;
};
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], label: string): T => {
  if (!allowed.includes(v as T)) fail(`${label} is not valid`);
  return v as T;
};
const functions = (v: readonly string[] | undefined): FunctionCode[] => {
  const codes = [...new Set(v ?? [])];
  for (const c of codes) if (!(c in FUNCTIONS)) fail("Safety-sensitive function is not valid");
  return codes as FunctionCode[];
};

const personIn = (c: Ctx, id: string): WithId<Person> => c.state.people.find((p) => p.id === id) ?? fail("Person not found");
const testIn = (c: Ctx, id: string): WithId<Test> => c.state.tests.find((t) => t.id === id) ?? fail("Test not found");

// ── Enrollment ───────────────────────────────────────────────────────────────

export interface Desk {
  orgName: string;
  program?: Program;
  state?: State;
  derName?: string;
  isDer: boolean;
}

/** The program and its state, or just the organization name when it has not enrolled. NotFound for non-members. */
export async function getDesk(actor: Actor, orgId: string): Promise<Desk> {
  assertClient(actor);
  return withTenant(principal(actor), async (tx) => {
    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.orgId, organizations.id))
      .where(and(eq(organizations.id, orgId), eq(memberships.userId, actor.id)));
    if (!org) throw new NotFoundError("Organization not found");
    const [row] = await tx.select().from(p120Programs).where(eq(p120Programs.orgId, orgId));
    if (!row) return { orgName: org.name, isDer: false };
    const program = programOf(row);
    const state = termsCurrent(program) ? await loadState(tx, await vaultFor(tx, orgId), program) : undefined;
    const [der] = await tx.select({ name: users.name }).from(users).where(eq(users.id, program.derUserId));
    return { orgName: org.name, program, state, derName: program.derUserId === actor.id ? actor.email : (der?.name ?? undefined), isDer: program.derUserId === actor.id };
  });
}

/** Start the program. The person who enrolls becomes the designated employer representative. */
export async function enroll(
  actor: Actor,
  orgId: string,
  input: { operation?: string; registrationKind?: string; registrationRef?: string; timeZone?: string } & TermsAcceptance,
): Promise<void> {
  assertClient(actor);
  const terms = acceptance(input);
  const operation = oneOf(input.operation, Object.keys(OPERATIONS) as Operation[], "Operation type");
  const registrationKind = oneOf(input.registrationKind, ["a449", "registration"] as const, "Registration type");
  const registrationRef = text(input.registrationRef, "Registration reference", 80);
  const timeZone = oneOf(input.timeZone, TIME_ZONES, "Time zone");
  await withTenant(principal(actor), async (tx) => {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, actor.id)));
    if (!member) throw new NotFoundError("Organization not found");
    const [existing] = await tx.select().from(p120Programs).where(eq(p120Programs.orgId, orgId));
    if (existing) fail("This organization already has a Part 120 program");
    await tx.insert(p120Programs).values({ orgId, operation, registrationKind, registrationRef, derUserId: actor.id, timeZone, ...terms, termsAcceptedBy: actor.id });
    await tx.insert(p120Log).values({ orgId, actorId: actor.id, type: "enrolled" });
    await tx.insert(p120Log).values({ orgId, actorId: actor.id, type: "terms_accepted" });
  });
}

export interface TermsAcceptance {
  /** The hash of the text the signer was shown; must match the text in force. */
  termsHash?: string;
  signerName?: string;
  signerTitle?: string;
}

function acceptance(input: TermsAcceptance) {
  if (input.termsHash !== termsHash()) fail("The terms have changed. Review and accept the current text");
  return {
    termsVersion: TERMS.version,
    termsHash: termsHash(),
    termsSigner: `${text(input.signerName, "Signer name", 120)}, ${text(input.signerTitle, "Signer title", 80)}`,
    termsAcceptedAt: new Date(),
  };
}

/** Accept revised terms. Only the designated employer representative can bind the employer. */
export async function acceptTerms(actor: Actor, orgId: string, input: TermsAcceptance): Promise<void> {
  assertClient(actor);
  const terms = acceptance(input);
  await withTenant(principal(actor), async (tx) => {
    const [row] = await tx.select().from(p120Programs).where(eq(p120Programs.orgId, orgId));
    if (!row) throw new NotFoundError("Part 120 program not found");
    if (row.derUserId !== actor.id) throw new ForbiddenError("Only the designated employer representative can accept the terms");
    await tx.update(p120Programs).set({ ...terms, termsAcceptedBy: actor.id }).where(eq(p120Programs.orgId, orgId));
    await tx.insert(p120Log).values({ orgId, actorId: actor.id, type: "terms_accepted" });
  });
}

const requireDer = (actor: Actor, c: Ctx) => {
  if (c.state.program.derUserId !== actor.id) throw new ForbiddenError("Only the designated employer representative can do this");
};

// ── Roster ───────────────────────────────────────────────────────────────────

export async function addPerson(
  actor: Actor,
  orgId: string,
  input: { name?: string; title?: string; functions?: string[]; supervisor?: boolean; medical?: boolean; airman?: boolean; hiredOn?: string; contractorId?: string },
  now = new Date(),
): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const fns = functions(input.functions);
    if (!fns.length) fail("Choose at least one safety-sensitive function");
    if (input.contractorId && !c.state.contractors.some((x) => x.id === input.contractorId)) fail("Contractor not found");
    const person: Person = {
      name: text(input.name, "Name", 120),
      title: text(input.title, "Job title", 80),
      functions: fns,
      supervisor: !!input.supervisor,
      medical: !!input.medical,
      airman: !!input.airman,
      contractorId: input.contractorId || undefined,
      hiredOn: input.hiredOn ? date(input.hiredOn, "Hire date", c.today) : undefined,
      priorEmployers: [],
      training: [],
    };
    const id = await c.create("person", person);
    await c.log("person_added", { id });
    return id;
  });
}

type PersonStep =
  | { step: "consent"; on?: string; refused?: boolean }
  | { step: "asked"; on?: string; admitted?: boolean }
  | { step: "no_prior_dot" }
  | { step: "prior_employer"; name?: string; requestedOn?: string }
  | { step: "prior_response"; index?: number; receivedOn?: string; violation?: boolean }
  | { step: "good_faith"; on?: string; note?: string }
  | { step: "return_to_duty"; on?: string }
  | { step: "training"; kind?: string; on?: string; minutes?: number }
  | { step: "separate"; on?: string };

/** One documented step in a person's file. Each is a fact the employer attests to; nothing is inferred. */
export async function recordPersonStep(actor: Actor, orgId: string, personId: string, input: PersonStep, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const p = personIn(c, personId);
    switch (input.step) {
      case "consent":
        if (input.refused) {
          p.consentRefused = true;
          p.consentOn = undefined;
        } else {
          p.consentOn = date(input.on, "Consent date", c.today);
          p.consentRefused = false;
        }
        break;
      case "asked":
        p.askedOn = date(input.on, "Date asked", c.today);
        p.admitted = !!input.admitted;
        break;
      case "no_prior_dot":
        if (p.priorEmployers.length) fail("Prior employers are already listed for this person");
        p.noPriorDot = true;
        break;
      case "prior_employer":
        p.noPriorDot = false;
        p.priorEmployers.push({ name: text(input.name, "Employer name", 120), requestedOn: input.requestedOn ? date(input.requestedOn, "Request date", c.today) : undefined });
        break;
      case "prior_response": {
        const e = p.priorEmployers[input.index ?? -1] ?? fail("Prior employer not found");
        e.receivedOn = date(input.receivedOn, "Date received", c.today);
        e.requestedOn ??= e.receivedOn;
        e.violation = !!input.violation;
        break;
      }
      case "good_faith":
        p.goodFaithOn = date(input.on, "Date", c.today);
        p.goodFaithNote = text(input.note, "What was done", 500);
        break;
      case "return_to_duty":
        p.returnToDutyOn = date(input.on, "Return-to-duty date", c.today);
        break;
      case "training": {
        const minutes = Number(input.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) fail("Minutes must be a whole number from 1 to 600");
        p.training.push({ kind: oneOf(input.kind, ["employee", "supervisor_drug", "supervisor_alcohol"] as TrainingKind[], "Training type"), on: date(input.on, "Training date", c.today), minutes });
        break;
      }
      case "separate":
        p.separatedOn = date(input.on, "Separation date", c.today);
        break;
    }
    await c.save("person", p);
    await c.log(`person_${input.step}`, { id: personId });
  });
}

/**
 * Put a person on safety-sensitive duty. This is the gate: it refuses unless the
 * clearance rules pass on the day of the assignment.
 */
export async function assignDuty(actor: Actor, orgId: string, personId: string, input: { on?: string }, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const p = personIn(c, personId);
    if (p.firstDutyOn) fail("This person is already assigned to duty");
    const on = date(input.on ?? c.today, "Duty date", c.today);
    const result = clearance(p, c.state.tests, on);
    if (!result.cleared) throw new ClearanceError(result.blockers);
    p.firstDutyOn = on;
    await c.save("person", p);
    await c.log("duty_assigned", { id: personId, on });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

export async function orderTest(
  actor: Actor,
  orgId: string,
  input: { personId?: string; reason?: string; substance?: string; on?: string },
  now = new Date(),
): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const p = personIn(c, input.personId ?? "");
    const reason = oneOf(input.reason, ["pre_employment", "return_to_duty", "follow_up"] as TestReason[], "Test type");
    const substance = oneOf(input.substance, ["drug", "alcohol"] as Substance[], "Substance");
    const test: Test = { personId: p.id, reason, substance, orderedOn: date(input.on ?? c.today, "Order date", c.today) };
    const id = await c.create("test", test);
    await c.log("test_ordered", { id, reason, substance });
    return id;
  });
}

const RESULTS: Record<Substance, TestResult[]> = {
  drug: ["negative", "positive", "refusal", "cancelled"],
  alcohol: ["negative", "low", "positive", "refusal", "cancelled"],
};

/** Record when the specimen was collected. For event tests this is checked against the event's clocks. */
export async function recordCollection(
  actor: Actor,
  orgId: string,
  testId: string,
  input: { collectedLocal?: string; delayReason?: string },
  now = new Date(),
): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const t = testIn(c, testId);
    if (t.collectedAt || t.result || t.notAdministeredReason) fail("This test is already closed");
    const at = zonedToUtc(input.collectedLocal ?? "", c.state.program.timeZone) ?? fail("Collection time must be a date and time");
    if (at > now) fail("Collection time cannot be in the future");
    const collectedAt = at.toISOString();
    const incident = c.state.incidents.find((i) => i.id === t.eventId);
    if (incident) {
      const problem = collectionProblem(incident, t.substance, collectedAt, input.delayReason);
      if (problem) fail(problem);
    }
    t.collectedAt = collectedAt;
    if (input.delayReason?.trim()) t.delayReason = input.delayReason.trim().slice(0, 500);
    await c.save("test", t);
    await c.log("test_collected", { id: testId });
  });
}

export async function recordNotAdministered(actor: Actor, orgId: string, testId: string, input: { reason?: string }, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const t = testIn(c, testId);
    if (t.collectedAt || t.result || t.notAdministeredReason) fail("This test is already closed");
    t.notAdministeredReason = text(input.reason, "Reason", 500);
    await c.save("test", t);
    await c.log("test_not_administered", { id: testId });
  });
}

/** Record the verified result. Only the medical review officer's verified result, or the confirmed alcohol result, belongs here. */
export async function recordResult(
  actor: Actor,
  orgId: string,
  testId: string,
  input: { result?: string; verifiedOn?: string; collectedOn?: string },
  now = new Date(),
): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const t = testIn(c, testId);
    if (t.result) fail("A result is already recorded for this test");
    if (t.notAdministeredReason) fail("This test was recorded as not administered");
    const result = oneOf(input.result, RESULTS[t.substance], "Result");
    const verifiedOn = date(input.verifiedOn, "Verified date", c.today);
    const tz = c.state.program.timeZone;
    if (!t.collectedAt && result !== "refusal") {
      if (t.eventId) fail("Record the collection time for this event test first");
      const collectedOn = date(input.collectedOn, "Collection date", c.today);
      if (collectedOn < t.orderedOn) fail("Collection date is before the test was ordered");
      t.collectedAt = zonedToUtc(`${collectedOn}T12:00`, tz)!.toISOString();
    }
    if (t.collectedAt && verifiedOn < todayIn(tz, new Date(t.collectedAt))) fail("Verified date is before the collection date");
    t.result = result;
    t.verifiedOn = verifiedOn;
    await c.save("test", t);
    await c.log("test_result", { id: testId, result });
  });
}

export async function markReported(actor: Actor, orgId: string, testId: string, input: { to?: string; on?: string }, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const t = testIn(c, testId);
    if (t.result !== "positive" && t.result !== "refusal") fail("This test has no reportable result");
    const on = date(input.on, "Report date", c.today);
    if (oneOf(input.to, ["fas", "faa"] as const, "Recipient") === "fas") t.reportedFasOn = on;
    else t.reportedFaaOn = on;
    await c.save("test", t);
    await c.log("report_sent", { id: testId, to: input.to });
  });
}

// ── Random draws ─────────────────────────────────────────────────────────────

/** Run this quarter's random draw. One draw per quarter; selections become open tests. */
export async function runDraw(actor: Actor, orgId: string, now = new Date(), pick: (n: number) => number = randomInt): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const year = Number(c.today.slice(0, 4));
    const period = quarterOf(c.today);
    if (c.state.draws.some((d) => d.year === year && d.period === period)) fail(`The Q${period} draw has already been run`);
    const plan = planDraw(c.state, year, period, c.today, pick);
    if (!plan.poolIds.length) fail("No one is in the random pool yet");
    const drawId = randomUUID();
    const selections: Draw["selections"] = [];
    for (const s of plan.selections) {
      const test: Test = { personId: s.personId, reason: "random", substance: s.substance, orderedOn: c.today, drawId };
      selections.push({ ...s, testId: await c.create("test", test) });
    }
    const draw: Draw = { year, period, drawnAt: now.toISOString(), poolIds: plan.poolIds, selections, method: "node:crypto randomInt, without replacement within a draw" };
    await c.create("draw", draw, drawId); // under the id the tests already reference
    await c.log("draw_run", { id: drawId, year, period, pool: plan.poolIds.length, selected: selections.length });
    return drawId;
  });
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function logIncident(
  actor: Actor,
  orgId: string,
  input: { kind?: string; personId?: string; occurredLocal?: string; note?: string; testingRequired?: boolean },
  now = new Date(),
): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const kind = oneOf(input.kind, ["post_accident", "reasonable_cause"] as const, "Event type");
    const p = personIn(c, input.personId ?? "");
    const at = zonedToUtc(input.occurredLocal ?? "", c.state.program.timeZone) ?? fail("Event time must be a date and time");
    if (at > now) fail("Event time cannot be in the future");
    const id = randomUUID();
    // A reasonable-cause determination always leads to testing; a post-accident one may rule the employee out.
    const testingRequired = kind === "reasonable_cause" ? true : !!input.testingRequired;
    const incident: Incident = { kind, personId: p.id, occurredAt: at.toISOString(), note: text(input.note, "What happened", 1000), testingRequired };
    if (testingRequired) {
      const base = { personId: p.id, reason: kind, orderedOn: todayIn(c.state.program.timeZone, at), eventId: id } as const;
      incident.drugTestId = await c.create("test", { ...base, substance: "drug" } satisfies Test);
      incident.alcoholTestId = await c.create("test", { ...base, substance: "alcohol" } satisfies Test);
    }
    await c.create("incident", incident, id);
    await c.log("incident_logged", { id, kind, testingRequired });
    return id;
  });
}

// ── Contractors ──────────────────────────────────────────────────────────────

export async function addContractor(actor: Actor, orgId: string, input: { name?: string; work?: string; functions?: string[] }, now = new Date()): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const contractor: Contractor = { name: text(input.name, "Contractor name", 120), work: text(input.work, "Work performed", 200), functions: functions(input.functions), coverage: "none" };
    const id = await c.create("contractor", contractor);
    await c.log("contractor_added", { id });
    return id;
  });
}

export async function setCoverage(
  actor: Actor,
  orgId: string,
  contractorId: string,
  input: { coverage?: string; evidenceRef?: string; evidenceOn?: string },
  now = new Date(),
): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    const k = c.state.contractors.find((x) => x.id === contractorId) ?? fail("Contractor not found");
    k.coverage = oneOf(input.coverage, ["own_program", "our_pool", "none"] as Coverage[], "Coverage");
    if (k.coverage === "own_program") {
      k.evidenceRef = text(input.evidenceRef, "Program reference", 80);
      k.evidenceOn = date(input.evidenceOn, "Date received", c.today);
    } else {
      k.evidenceRef = undefined;
      k.evidenceOn = undefined;
    }
    await c.save("contractor", k);
    await c.log("contractor_coverage", { id: contractorId, coverage: k.coverage });
  });
}

// ── Annual report ────────────────────────────────────────────────────────────

/** Record that the annual report was filed. A service agent may prepare it; a company official certifies it. */
export async function fileMis(actor: Actor, orgId: string, input: { year?: number; filedOn?: string; certifiedBy?: string }, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    requireDer(actor, c);
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 2000 || year >= Number(c.today.slice(0, 4))) fail("Report year must be a completed calendar year");
    if (c.state.filings.some((f) => f.year === year)) fail(`The ${year} report is already recorded as filed`);
    const filing: MisFiling = { year, filedOn: date(input.filedOn, "Filing date", c.today), certifiedBy: text(input.certifiedBy, "Certifying official", 120), counts: misCounts(c.state, year) };
    const id = await c.create("filing", filing);
    await c.log("mis_filed", { id, year });
  });
}

export async function setMisNotified(actor: Actor, orgId: string, notified: boolean, now = new Date()): Promise<void> {
  await run(actor, orgId, now, async (c) => {
    requireDer(actor, c);
    await c.tx.update(p120Programs).set({ misNotified: notified }).where(eq(p120Programs.orgId, orgId));
    await c.log("mis_notice", { notified });
  });
}

// ── Exports ──────────────────────────────────────────────────────────────────

const cell = (v: string) => {
  // Neutralize spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * The roster with each person's clearance, for a scheduling system to import. It says who is
 * cleared and nothing about why: reasons can reveal a test result, which is confidential.
 */
export async function rosterCsv(actor: Actor, orgId: string, now = new Date()): Promise<string> {
  return run(actor, orgId, now, async (c) => {
    const rows = [["name", "title", "functions", "status", "first_duty"]];
    for (const p of c.state.people) {
      if (p.separatedOn && p.separatedOn <= c.today) continue;
      rows.push([p.name, p.title, functionNames(p.functions), clearance(p, c.state.tests, c.today).cleared ? "cleared" : "blocked", p.firstDutyOn ?? ""]);
    }
    await c.log("roster_exported");
    return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  });
}

export interface LogEntry {
  at: Date;
  type: string;
  actor: string;
}

export async function recentLog(actor: Actor, orgId: string, limit = 25): Promise<LogEntry[]> {
  assertClient(actor);
  return withTenant(principal(actor), async (tx) => {
    const rows = await tx
      .select({ at: p120Log.createdAt, type: p120Log.type, name: users.name, actorId: p120Log.actorId })
      .from(p120Log)
      .leftJoin(users, eq(users.id, p120Log.actorId))
      .where(eq(p120Log.orgId, orgId))
      .orderBy(desc(p120Log.createdAt))
      .limit(limit);
    return rows.map((r) => ({ at: r.at, type: r.type, actor: r.actorId === actor.id ? "You" : (r.name ?? "A colleague") }));
  });
}

export { TEST_REASONS };
