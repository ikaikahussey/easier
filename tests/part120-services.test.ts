import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, type Db } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { createOrganization } from "@/core/services/organizations";
import { ForbiddenError, NotFoundError, ValidationError, type Actor } from "@/core/services/context";
import { audit, clearance, openItems, randomStatus } from "@/programs/part-120/rules";
import {
  acceptTerms,
  addContractor,
  addPerson,
  assignDuty,
  ClearanceError,
  enroll,
  fileMis,
  getDesk,
  logIncident,
  markReported,
  orderTest,
  recentLog,
  recordCollection,
  recordNotAdministered,
  recordPersonStep,
  recordResult,
  rosterCsv,
  runDraw,
  setCoverage,
  setMisNotified,
} from "@/programs/part-120/service";
import { TERMS, termsHash } from "@/programs/part-120/terms";
import { freshDb, makeUser } from "./helpers/db";

let db: Db;
let dana: Actor; // DER at Ridgeback
let luis: Actor; // second member at Ridgeback
let bob: Actor; // another employer
let rita: Actor; // easier.company reviewer
let org: string;
let other: string;

const ENROLL = { operation: "part135", registrationKind: "a449", registrationRef: "A449 / RBK-135", timeZone: "Pacific/Honolulu", termsHash: termsHash(), signerName: "Dana Okafor", signerTitle: "Director of Operations" };
// Thursday 2026-11-26, 09:30 in Honolulu.
const NOW = new Date("2026-11-26T19:30:00Z");

beforeAll(async () => {
  db = await freshDb();
  dana = await makeUser(db, "dana@ridgeback.example");
  luis = await makeUser(db, "luis@ridgeback.example");
  bob = await makeUser(db, "bob@other.example");
  rita = await makeUser(db, "rita@easier.company", "reviewer");
  org = (await createOrganization(dana, { name: "Ridgeback Air Charter" })).id;
  other = (await createOrganization(bob, { name: "Other Air" })).id;
  await db.insert(schema.memberships).values({ orgId: org, userId: luis.id, role: "member" });
});

const desk = async (who: Actor = dana) => (await getDesk(who, org)).state!;

/** Document a hire far enough to pass the gate. */
async function clear(personId: string, on = "2026-11-20") {
  const testId = await orderTest(dana, org, { personId, reason: "pre_employment", substance: "drug", on }, NOW);
  await recordResult(dana, org, testId, { result: "negative", verifiedOn: "2026-11-24", collectedOn: "2026-11-21" }, NOW);
  await recordPersonStep(dana, org, personId, { step: "consent", on }, NOW);
  await recordPersonStep(dana, org, personId, { step: "asked", on, admitted: false }, NOW);
  await recordPersonStep(dana, org, personId, { step: "no_prior_dot" }, NOW);
}

describe("enrollment and access", () => {
  it("shows an unenrolled organization to its members only", async () => {
    expect(await getDesk(dana, org)).toMatchObject({ orgName: "Ridgeback Air Charter", isDer: false });
    await expect(getDesk(bob, org)).rejects.toThrow(NotFoundError);
    await expect(getDesk(rita, org)).rejects.toThrow(ForbiddenError);
  });

  it("validates enrollment and makes the enrolling member the representative", async () => {
    await expect(enroll(dana, org, { ...ENROLL, timeZone: "Mars/Olympus" })).rejects.toThrow(ValidationError);
    await expect(enroll(dana, org, { ...ENROLL, termsHash: "stale" })).rejects.toThrow(/terms have changed/);
    await expect(enroll(dana, org, { ...ENROLL, signerTitle: " " })).rejects.toThrow(/Signer title is required/);
    await expect(enroll(bob, org, ENROLL)).rejects.toThrow(NotFoundError);
    await expect(enroll(rita, org, ENROLL)).rejects.toThrow(ForbiddenError);
    await enroll(dana, org, ENROLL);
    await expect(enroll(luis, org, ENROLL)).rejects.toThrow(/already has/);
    const d = await getDesk(dana, org);
    expect(d.program).toMatchObject({ operation: "part135", registrationRef: "A449 / RBK-135", derUserId: dana.id, timeZone: "Pacific/Honolulu" });
    expect(d.program).toMatchObject({ termsHash: termsHash(), termsSigner: "Dana Okafor, Director of Operations" });
    expect(d.isDer).toBe(true);
    expect((await getDesk(luis, org)).isDer).toBe(false);
  });

  it("refuses every operation to non-members and to staff", async () => {
    await expect(addPerson(bob, org, { name: "X", title: "Y", functions: ["maintenance"] }, NOW)).rejects.toThrow(NotFoundError);
    await expect(addPerson(rita, org, { name: "X", title: "Y", functions: ["maintenance"] }, NOW)).rejects.toThrow(ForbiddenError);
    await expect(rosterCsv(bob, org, NOW)).rejects.toThrow(NotFoundError);
    await expect(runDraw(bob, org, NOW)).rejects.toThrow(NotFoundError);
    // An organization that never enrolled has no program to act on.
    await expect(addPerson(bob, other, { name: "X", title: "Y", functions: ["maintenance"] }, NOW)).rejects.toThrow(NotFoundError);
  });
});

describe("clearance gate", () => {
  let hana: string;

  it("adds a hire and refuses duty until the file is complete", async () => {
    await expect(addPerson(dana, org, { name: "Hana Kim", title: "Mechanic", functions: [] }, NOW)).rejects.toThrow(/at least one/);
    await expect(addPerson(dana, org, { name: "Hana Kim", title: "Mechanic", functions: ["fueling"] }, NOW)).rejects.toThrow(ValidationError);
    hana = await addPerson(dana, org, { name: "Hana Kim", title: "Mechanic", functions: ["maintenance"], hiredOn: "2026-11-23" }, NOW);

    const blocked = await assignDuty(dana, org, hana, {}, NOW).catch((e) => e);
    expect(blocked).toBeInstanceOf(ClearanceError);
    expect((blocked as ClearanceError).blockers).toHaveLength(4);
    expect((await desk()).people[0]!.firstDutyOn).toBeUndefined();
  });

  it("keeps the gate closed while the result is pending, then opens it on the verified date", async () => {
    const testId = await orderTest(dana, org, { personId: hana, reason: "pre_employment", substance: "drug", on: "2026-11-23" }, NOW);
    await recordPersonStep(dana, org, hana, { step: "consent", on: "2026-11-23" }, NOW);
    await recordPersonStep(dana, org, hana, { step: "asked", on: "2026-11-23", admitted: false }, NOW);
    await recordPersonStep(dana, org, hana, { step: "prior_employer", name: "Old Air", requestedOn: "2026-11-23" }, NOW);
    await expect(assignDuty(dana, org, hana, {}, NOW)).rejects.toThrow(/verified negative result not yet received/);

    await expect(recordResult(dana, org, testId, { result: "low", verifiedOn: "2026-11-25", collectedOn: "2026-11-24" }, NOW)).rejects.toThrow(ValidationError); // alcohol-only result
    await expect(recordResult(dana, org, testId, { result: "negative", verifiedOn: "2026-11-27", collectedOn: "2026-11-24" }, NOW)).rejects.toThrow(/future/);
    await expect(recordResult(dana, org, testId, { result: "negative", verifiedOn: "2026-11-23", collectedOn: "2026-11-24" }, NOW)).rejects.toThrow(/before the collection/);
    await recordResult(dana, org, testId, { result: "negative", verifiedOn: "2026-11-25", collectedOn: "2026-11-24" }, NOW);
    await expect(recordResult(dana, org, testId, { result: "positive", verifiedOn: "2026-11-25" }, NOW)).rejects.toThrow(/already recorded/);

    // Duty cannot be backdated to before the verified result.
    await expect(assignDuty(dana, org, hana, { on: "2026-11-24" }, NOW)).rejects.toThrow(ClearanceError);
    await assignDuty(luis, org, hana, { on: "2026-11-26" }, NOW);
    await expect(assignDuty(dana, org, hana, {}, NOW)).rejects.toThrow(/already assigned/);

    const s = await desk();
    const p = s.people.find((x) => x.id === hana)!;
    expect(p.firstDutyOn).toBe("2026-11-26");
    expect(clearance(p, s.tests, "2026-11-26").warnings[0]).toMatch(/30 days left/);
  });

  it("closes the gate again 31 days in without prior-employer records, and reopens on a good-faith record", async () => {
    const later = new Date("2026-12-28T19:30:00Z");
    expect(openItems(await desk(), later)[0]).toMatchObject({ severity: "critical", title: "Hana Kim is performing safety-sensitive duty without clearance" });
    await recordPersonStep(dana, org, hana, { step: "good_faith", on: "2026-12-20", note: "Two faxes and a call to Old Air; no reply." }, later);
    expect(openItems(await desk(), later).filter((i) => i.severity === "critical")).toEqual([]);
  });
});

describe("random draws", () => {
  it("draws once per quarter from people on duty and opens a test for each selection", async () => {
    for (const name of ["Dana Okafor", "Luis Marrero", "Priya Raman", "Tom Halvorsen"]) {
      const id = await addPerson(dana, org, { name, title: "Pilot", functions: ["flight_crew"], medical: true, airman: true }, NOW);
      await clear(id);
      await assignDuty(dana, org, id, { on: "2026-11-25" }, NOW);
      await recordPersonStep(dana, org, id, { step: "training", kind: "employee", on: "2026-11-25", minutes: 60 }, NOW);
    }
    // Pool order is Hana, then the four pilots. These picks choose Dana and Luis for drugs and Luis for alcohol.
    const picks = [1, 1, 2];
    await runDraw(dana, org, NOW, () => picks.shift()!);
    await expect(runDraw(dana, org, NOW)).rejects.toThrow(/Q4 draw has already been run/);

    const s = await desk();
    expect(s.draws).toHaveLength(1);
    const draw = s.draws[0]!;
    expect(draw).toMatchObject({ year: 2026, period: 4 });
    expect(draw.poolIds).toHaveLength(5); // four pilots and Hana
    // 25% of 5 → 2 drug; 10% of 5 → 1 alcohol; all due by Q4.
    expect(draw.selections.map((x) => x.substance)).toEqual(["drug", "drug", "alcohol"]);
    for (const sel of draw.selections) expect(s.tests.find((t) => t.id === sel.testId)).toMatchObject({ reason: "random", personId: sel.personId, drawId: draw.id });
    const rs = randomStatus(s, 2026, "2026-11-26");
    expect(rs.required).toEqual({ drug: 2, alcohol: 1 });
    expect(rs.completed).toEqual({ drug: 0, alcohol: 0 });
    expect(rs.outstanding).toHaveLength(3);
  });

  it("closes selections by collection, result, or a recorded reason", async () => {
    const s = await desk();
    const [a, b, c] = s.draws[0]!.selections;
    await recordResult(dana, org, a!.testId, { result: "negative", verifiedOn: "2026-11-26", collectedOn: "2026-11-26" }, NOW);
    await recordNotAdministered(dana, org, b!.testId, { reason: "On approved leave through year end" }, NOW);
    await expect(recordResult(dana, org, b!.testId, { result: "negative", verifiedOn: "2026-11-26", collectedOn: "2026-11-26" }, NOW)).rejects.toThrow(/not administered/);
    await recordResult(dana, org, c!.testId, { result: "refusal", verifiedOn: "2026-11-26" }, NOW);

    const after = await desk();
    const rs = randomStatus(after, 2026, "2026-11-26");
    expect(rs.completed).toEqual({ drug: 1, alcohol: 1 });
    expect(rs.outstanding).toHaveLength(0);

    // The refusal by a pilot creates both reports and removes the pilot from duty.
    const items = openItems(after, NOW).map((i) => i.title);
    const who = after.people.find((p) => p.id === c!.personId)!.name;
    expect(items).toContain(`Report refusal to test to the Federal Air Surgeon: ${who}`);
    expect(items).toContain(`Report refusal by a certificate holder to the FAA Drug Abatement Division: ${who}`);
    expect(items).toContain(`${who} is performing safety-sensitive duty without clearance`);
    await markReported(dana, org, c!.testId, { to: "fas", on: "2026-11-26" }, NOW);
    await markReported(dana, org, c!.testId, { to: "faa", on: "2026-11-26" }, NOW);
    await expect(markReported(dana, org, a!.testId, { to: "fas", on: "2026-11-26" }, NOW)).rejects.toThrow(/no reportable/);
    expect(audit(await desk(), NOW).find((i) => i.id === "reports")?.status).toBe("pass");
  });
});

describe("event clocks", () => {
  it("opens both tests after an accident and enforces the time limits", async () => {
    const s = await desk();
    const pilot = s.people.find((p) => p.name === "Priya Raman")!;
    await expect(logIncident(dana, org, { kind: "post_accident", personId: pilot.id, occurredLocal: "2026-11-26T10:00", note: "x", testingRequired: true }, NOW)).rejects.toThrow(/future/);
    // 07:00 in Honolulu is 17:00Z; NOW is 2.5 hours later.
    const id = await logIncident(dana, org, { kind: "post_accident", personId: pilot.id, occurredLocal: "2026-11-26T07:00", note: "Runway excursion, no injuries.", testingRequired: true }, NOW);
    const after = await desk();
    const incident = after.incidents.find((i) => i.id === id)!;
    expect(incident.occurredAt).toBe("2026-11-26T17:00:00.000Z");
    expect(openItems(after, NOW).filter((i) => i.view === "events").map((i) => i.title)).toEqual(["Drug test clock running: Priya Raman", "Alcohol test clock running: Priya Raman"]);

    await expect(recordCollection(dana, org, incident.alcoholTestId!, { collectedLocal: "2026-11-26T09:15" }, NOW)).rejects.toThrow(/more than 2 hours/);
    await recordCollection(dana, org, incident.alcoholTestId!, { collectedLocal: "2026-11-26T09:15", delayReason: "Nearest breath alcohol technician was 90 minutes away." }, NOW);
    await expect(recordCollection(dana, org, incident.alcoholTestId!, { collectedLocal: "2026-11-26T09:20", delayReason: "x" }, NOW)).rejects.toThrow(/already closed/);
    await expect(recordResult(dana, org, incident.drugTestId!, { result: "negative", verifiedOn: "2026-11-26", collectedOn: "2026-11-26" }, NOW)).rejects.toThrow(/collection time for this event test first/);

    // Two days later the 32-hour drug window is closed: only a reason can be recorded.
    const late = new Date("2026-11-28T19:30:00Z");
    await expect(recordCollection(dana, org, incident.drugTestId!, { collectedLocal: "2026-11-28T08:00" }, late)).rejects.toThrow(/within 32 hours/);
    expect(openItems(await desk(), late).map((i) => i.title)).toContain("Drug test window closed: Priya Raman");
    await recordNotAdministered(dana, org, incident.drugTestId!, { reason: "Collection site closed for the holiday; no alternative within 32 hours." }, late);
    expect(openItems(await desk(), late).filter((i) => i.view === "events")).toEqual([]);
  });

  it("records a post-accident decision not to test without opening tests", async () => {
    const s = await desk();
    const pilot = s.people.find((p) => p.name === "Tom Halvorsen")!;
    const before = s.tests.length;
    await logIncident(dana, org, { kind: "post_accident", personId: pilot.id, occurredLocal: "2026-11-26T06:00", note: "Parked aircraft struck by a tug; crew not aboard.", testingRequired: false }, NOW);
    const after = await desk();
    expect(after.tests).toHaveLength(before);
    expect(after.incidents.at(-1)).toMatchObject({ testingRequired: false });
  });
});

describe("contractors and the annual report", () => {
  it("tracks coverage for safety-sensitive contractors only", async () => {
    const engines = await addContractor(dana, org, { name: "Coastline Turbine Repair", work: "Engine maintenance", functions: ["maintenance"] }, NOW);
    await addContractor(dana, org, { name: "Summit Fuel Services", work: "Fueling", functions: [] }, NOW);
    let titles = openItems(await desk(), NOW).map((i) => i.title);
    expect(titles).toContain("Coastline Turbine Repair has no testing coverage on file");
    expect(titles.some((t) => t.includes("Summit Fuel"))).toBe(false);
    await expect(setCoverage(dana, org, engines, { coverage: "own_program" }, NOW)).rejects.toThrow(/Program reference is required/);
    await setCoverage(dana, org, engines, { coverage: "own_program", evidenceRef: "A449 / CTR-145", evidenceOn: "2026-11-20" }, NOW);
    titles = openItems(await desk(), NOW).map((i) => i.title);
    expect(titles.some((t) => t.includes("Coastline"))).toBe(false);
  });

  it("lets only the representative certify the report and record an FAA notice", async () => {
    await expect(setMisNotified(luis, org, true, NOW)).rejects.toThrow(ForbiddenError);
    await expect(fileMis(luis, org, { year: 2025, filedOn: "2026-03-01", certifiedBy: "Luis" }, NOW)).rejects.toThrow(ForbiddenError);
    await setMisNotified(dana, org, true, NOW);
    expect(openItems(await desk(), NOW).map((i) => i.title)).toContain("Annual report for 2025 not filed");
    await expect(fileMis(dana, org, { year: 2026, filedOn: "2026-11-26", certifiedBy: "Dana Okafor" }, NOW)).rejects.toThrow(/completed calendar year/);
    await fileMis(dana, org, { year: 2025, filedOn: "2026-03-01", certifiedBy: "Dana Okafor" }, NOW);
    await expect(fileMis(dana, org, { year: 2025, filedOn: "2026-03-01", certifiedBy: "Dana Okafor" }, NOW)).rejects.toThrow(/already recorded/);
    expect(audit(await desk(), NOW).find((i) => i.id === "mis")).toMatchObject({ status: "pass", detail: "Filed 2026-03-01" });
  });
});

describe("exports, log, and isolation", () => {
  it("exports the roster with clearance and no reasons or test results", async () => {
    const hana = (await desk()).people.find((p) => p.name === "Hana Kim")!.id;
    await recordPersonStep(dana, org, hana, { step: "training", kind: "employee", on: "2026-11-26", minutes: 45 }, NOW);
    const evil = await addPerson(dana, org, { name: "=HYPERLINK(\"x\")", title: 'Lead "A&P"', functions: ["maintenance"] }, NOW);
    const csv = await rosterCsv(luis, org, NOW);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe('"name","title","functions","status","first_duty"');
    expect(lines.find((l) => l.startsWith('"Hana Kim"'))).toBe('"Hana Kim","Mechanic","Aircraft maintenance or preventive maintenance","cleared","2026-11-26"');
    expect(lines.find((l) => l.includes("HYPERLINK"))).toMatch(/^"'=HYPERLINK\(""x""\)","Lead ""A&P""",.*"blocked",""$/);
    // Luis is blocked after a refusal; the export says so without saying why.
    expect(lines.find((l) => l.startsWith('"Luis Marrero"'))).toBe('"Luis Marrero","Pilot","Flight crewmember","blocked","2026-11-25"');
    expect(csv).not.toMatch(/negative|positive|refus|violation/i);
    await recordPersonStep(dana, org, evil, { step: "separate", on: "2026-11-26" }, NOW);
    expect(await rosterCsv(dana, org, NOW)).not.toMatch(/HYPERLINK/);
  });

  it("keeps an append-only log of who did what", async () => {
    const log = await recentLog(luis, org, 200);
    expect(log.at(-1)).toMatchObject({ type: "enrolled", actor: "A colleague" });
    expect(log.map((l) => l.type)).toEqual(expect.arrayContaining(["person_added", "test_ordered", "test_result", "duty_assigned", "draw_run", "incident_logged", "report_sent", "mis_filed", "roster_exported"]));
    expect(log.some((l) => l.actor === "You")).toBe(true);
    // The restricted role cannot rewrite or delete history.
    await expect(withTenant({ userId: dana.id, staff: false }, (tx) => tx.delete(schema.p120Log).where(eq(schema.p120Log.orgId, org)))).rejects.toThrow();
    await expect(withTenant({ userId: dana.id, staff: false }, (tx) => tx.update(schema.p120Log).set({ type: "x" }).where(eq(schema.p120Log.orgId, org)))).rejects.toThrow();
    await expect(withTenant({ userId: dana.id, staff: false }, (tx) => tx.delete(schema.p120Records).where(eq(schema.p120Records.orgId, org)))).rejects.toThrow();
  });

  it("stores every record sealed and hides the tables from other tenants and from staff", async () => {
    const raw = await db.select().from(schema.p120Records).where(eq(schema.p120Records.orgId, org));
    expect(raw.length).toBeGreaterThan(15);
    for (const r of raw) {
      expect(r.dataEnc.startsWith("v1.")).toBe(true);
      expect(r.dataEnc).not.toMatch(/Hana|Priya|negative|refusal/);
    }
    for (const p of [
      { userId: bob.id, staff: false },
      { userId: rita.id, staff: true },
    ]) {
      const seen = await withTenant(p, async (tx) => ({
        programs: await tx.select().from(schema.p120Programs),
        records: await tx.select().from(schema.p120Records),
        log: await tx.select().from(schema.p120Log),
      }));
      expect(seen).toEqual({ programs: [], records: [], log: [] });
    }
    // A member cannot write into another tenant, or name an outsider as the representative.
    await expect(
      withTenant({ userId: bob.id, staff: false }, (tx) => tx.insert(schema.p120Records).values({ orgId: org, kind: "person", dataEnc: "v1.x.y.z" })),
    ).rejects.toThrow();
    await expect(
      withTenant({ userId: bob.id, staff: false }, (tx) =>
        tx.insert(schema.p120Programs).values({ orgId: other, operation: "part135", registrationKind: "a449", registrationRef: "x", derUserId: dana.id, timeZone: "UTC" }),
      ),
    ).rejects.toThrow();
  });

  it("pauses the desk when the terms change until the representative accepts them", async () => {
    const [before] = await db.select().from(schema.p120Programs).where(eq(schema.p120Programs.orgId, org));
    expect(before).toMatchObject({ termsVersion: TERMS.version, termsAcceptedBy: dana.id });
    // Simulate a revision: the stored acceptance no longer matches the text in force.
    await db.update(schema.p120Programs).set({ termsHash: "an-earlier-text" }).where(eq(schema.p120Programs.orgId, org));
    const paused = await getDesk(luis, org);
    expect(paused.program).toBeDefined();
    expect(paused.state).toBeUndefined(); // nothing is decrypted while paused
    await expect(addPerson(dana, org, { name: "X", title: "Y", functions: ["maintenance"] }, NOW)).rejects.toThrow(/accept the current Part 120 terms/);
    await expect(rosterCsv(dana, org, NOW)).rejects.toThrow(ForbiddenError);
    await expect(runDraw(luis, org, NOW)).rejects.toThrow(ForbiddenError);
    await expect(acceptTerms(luis, org, ENROLL)).rejects.toThrow(/Only the designated employer representative/);
    await expect(acceptTerms(bob, org, ENROLL)).rejects.toThrow(NotFoundError);
    await expect(acceptTerms(dana, org, { ...ENROLL, termsHash: "an-earlier-text" })).rejects.toThrow(/terms have changed/);
    await acceptTerms(dana, org, { ...ENROLL, signerTitle: "Accountable Executive" });
    const resumed = await getDesk(luis, org);
    expect(resumed.program?.termsSigner).toBe("Dana Okafor, Accountable Executive");
    expect(resumed.state?.people.length).toBeGreaterThan(4);
    expect((await recentLog(dana, org, 3)).map((l) => l.type)).toContain("terms_accepted");
  });

  it("gives the same answer to the second member, who is not the representative", async () => {
    const mine = await desk(dana);
    const theirs = await desk(luis);
    expect(theirs.people.map((p) => p.name)).toEqual(mine.people.map((p) => p.name));
    expect(audit(theirs, NOW)).toEqual(audit(mine, NOW));
  });
});
