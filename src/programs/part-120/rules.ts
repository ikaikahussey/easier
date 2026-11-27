import {
  FUNCTIONS,
  TEST_REASONS,
  type Incident,
  type IsoDate,
  type IsoInstant,
  type MisRow,
  type Person,
  type State,
  type Substance,
  type Test,
  type TestReason,
  type WithId,
} from "./types";

/**
 * Rule values, each with its source. These are deterministic: no model call decides
 * anything in this module. Values were checked against the eCFR and FAA Drug Abatement
 * pages in November 2026; re-check them when either changes.
 */
export const RULES = {
  /**
   * Minimum annual random testing rates. The FAA publishes them each year in the Federal
   * Register (14 CFR 120.109(b), 120.217(c)). Years missing here fall back to DEFAULT_RATES
   * and the self-audit flags them as unconfirmed.
   */
  randomRates: { 2025: { drug: 0.25, alcohol: 0.1 }, 2026: { drug: 0.25, alcohol: 0.1 } } as Record<number, Record<Substance, number>>,
  /** Post-accident drug test: as soon as possible, not later than 32 hours (14 CFR 120.109(c)). */
  postAccidentDrugHours: 32,
  /** Alcohol test after 2 hours: record why it was late (14 CFR 120.217(b)(2), (d)(3)). */
  alcoholRecordHours: 2,
  /** Alcohol test after 8 hours: stop trying and record why (same paragraphs). */
  alcoholCeaseHours: 8,
  /** Prior-employer records must be obtained, or a good-faith effort documented, within 30 days of first duty (49 CFR 40.25(d)). */
  priorEmployerGraceDays: 30,
  /** Reports to the Federal Air Surgeon and the FAA are due within 2 working days (14 CFR 120.111(d), 120.113(d), 120.221(c)-(d)). */
  reportWorkingDays: 2,
  /** Supervisors who make determinations need at least 60 minutes of training for each of drugs and alcohol (14 CFR 120.115(c), 120.223(b)). */
  supervisorMinutes: 60,
  /** Annual report: every Part 121 holder, every employer with 50 or more covered employees on January 1, and anyone the FAA notifies (14 CFR 120.119). */
  misEmployeeThreshold: 50,
  /** Minimum retention in years (49 CFR 40.333; 14 CFR 120.111, 120.219). */
  keep: { violation: 5, report: 5, priorEmployer: 3, process: 2, training: 2, negative: 1, pilotNegative: 5 },
} as const;

export const DEFAULT_RATES: Record<Substance, number> = { drug: 0.25, alcohol: 0.1 };

export const ratesFor = (year: number) => ({
  rates: RULES.randomRates[year] ?? DEFAULT_RATES,
  confirmed: year in RULES.randomRates,
});

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);

export const addDays = (d: IsoDate, n: number): IsoDate => iso(new Date(utc(d).getTime() + n * 86_400_000));

export function addYears(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  // Feb 29 plus a non-leap year lands on Feb 28.
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${pad(m)}-${pad(Math.min(day, last))}`;
}

/** Skips Saturdays and Sundays. Federal holidays are not skipped, so this never gives a later date than the rule allows. */
export function addWorkingDays(d: IsoDate, n: number): IsoDate {
  let t = utc(d).getTime();
  for (let left = n; left > 0; ) {
    t += 86_400_000;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return iso(new Date(t));
}

const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

function partsIn(tz: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Today's date in the employer's time zone. */
export function todayIn(tz: string, now: Date): IsoDate {
  const p = partsIn(tz, now);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** The date an instant falls on in the employer's time zone. */
export const dateIn = (tz: string, at: IsoInstant): IsoDate => todayIn(tz, new Date(at));

/** "YYYY-MM-DDTHH:mm" wall-clock time in a zone → the instant it names. */
export function zonedToUtc(local: string, tz: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall)) return undefined;
  const offset = (at: number) => {
    const p = partsIn(tz, new Date(at));
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - at;
  };
  let guess = wall - offset(wall);
  guess = wall - offset(guess); // second pass settles times next to a daylight-saving change
  return new Date(guess);
}

export function formatIn(tz: string, at: IsoInstant): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

// ── Clearance gate ───────────────────────────────────────────────────────────

const isViolation = (t: Test) => t.result === "positive" || t.result === "refusal";

const preEmployment = (id: string, tests: WithId<Test>[]) =>
  tests.filter((t) => t.personId === id && t.reason === "pre_employment" && t.substance === "drug");

/** The earliest verified negative pre-employment drug result, if any. */
export function verifiedNegative(id: string, tests: WithId<Test>[]): IsoDate | undefined {
  return preEmployment(id, tests)
    .filter((t) => t.result === "negative" && t.verifiedOn)
    .map((t) => t.verifiedOn!)
    .sort()[0];
}

export const priorRecordsComplete = (p: Person) =>
  !!p.noPriorDot || (p.priorEmployers.length > 0 && p.priorEmployers.every((e) => e.receivedOn));

export interface Clearance {
  cleared: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Whether a person may perform safety-sensitive functions today.
 * 14 CFR 120.109(a): no hire or transfer into a safety-sensitive function before a verified
 * negative pre-employment drug result. 49 CFR 40.25: written consent, the two-year
 * prior-employer request, the direct question, and the 30-day limit.
 */
export function clearance(p: WithId<Person>, tests: WithId<Test>[], today: IsoDate): Clearance {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const negative = verifiedNegative(p.id, tests);
  if (!negative || negative > today) {
    const pending = preEmployment(p.id, tests).some((t) => !t.result);
    blockers.push(pending ? "Pre-employment drug test ordered; verified negative result not yet received" : "Pre-employment drug test not ordered");
  }

  if (p.consentRefused) blockers.push("Refused written consent to the prior-employer records request");
  else if (!p.consentOn) blockers.push("Written consent to the prior-employer records request not on file");

  if (!p.askedOn) blockers.push("Not yet asked about a positive or refused pre-employment test in the past two years");

  const requested = p.noPriorDot || (p.priorEmployers.length > 0 && p.priorEmployers.every((e) => e.requestedOn));
  if (!requested) blockers.push("Prior-employer testing records not requested");
  else if (!priorRecordsComplete(p)) {
    if (p.firstDutyOn && !p.goodFaithOn) {
      const left = RULES.priorEmployerGraceDays - daysBetween(p.firstDutyOn, today);
      if (left < 0) blockers.push("30 days have passed since first duty without prior-employer records or a documented good-faith effort");
      else warnings.push(`Prior-employer records outstanding: ${left} day${left === 1 ? "" : "s"} left to obtain them or document a good-faith effort`);
    } else if (!p.firstDutyOn) warnings.push("Prior-employer records requested but not yet received");
  }

  const priorViolation = p.admitted || p.priorEmployers.some((e) => e.violation);
  if (priorViolation && !p.returnToDutyOn) blockers.push("Prior violation reported; return-to-duty process not documented");

  const lastViolation = tests
    .filter((t) => t.personId === p.id && isViolation(t))
    .map((t) => t.verifiedOn ?? t.orderedOn)
    .sort()
    .at(-1);
  if (lastViolation && (!p.returnToDutyOn || p.returnToDutyOn < lastViolation))
    blockers.push("Removed from safety-sensitive duty after a violation; return-to-duty process not documented");

  return { cleared: blockers.length === 0, blockers, warnings };
}

/** First duty before the verified negative result arrived (typically an imported record). */
export function dutyBeforeResult(p: WithId<Person>, tests: WithId<Test>[]): boolean {
  if (!p.firstDutyOn) return false;
  const negative = verifiedNegative(p.id, tests);
  return !negative || p.firstDutyOn < negative;
}

export const isActive = (p: Person, on: IsoDate) => !!p.firstDutyOn && p.firstDutyOn <= on && (!p.separatedOn || p.separatedOn > on);

/** The random pool: everyone currently performing a safety-sensitive function under this program. */
export const pool = (s: State, today: IsoDate) => s.people.filter((p) => isActive(p, today));

// ── Random testing ───────────────────────────────────────────────────────────

export const quarterOf = (d: IsoDate) => Math.ceil(Number(d.slice(5, 7)) / 3);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const yearOf = (tz: string, t: Test) => (t.collectedAt ? Number(dateIn(tz, t.collectedAt).slice(0, 4)) : Number((t.verifiedOn ?? t.orderedOn).slice(0, 4)));
/** A test counts once a specimen was collected or the employee refused. */
const counted = (t: Test) => !!t.collectedAt || t.result === "refusal";
const isOpen = (t: Test) => !t.collectedAt && !t.result && !t.notAdministeredReason;

export interface RandomStatus {
  year: number;
  rates: Record<Substance, number>;
  ratesConfirmed: boolean;
  /** Covered employees averaged over the draws so far this year. */
  averagePool: number;
  required: Record<Substance, number>;
  completed: Record<Substance, number>;
  outstanding: WithId<Test>[];
  periodsDrawn: number[];
}

export function randomStatus(s: State, year: number, today: IsoDate): RandomStatus {
  const draws = s.draws.filter((d) => d.year === year);
  const { rates, confirmed } = ratesFor(year);
  const averagePool = draws.length ? mean(draws.map((d) => d.poolIds.length)) : pool(s, today).length;
  const random = s.tests.filter((t) => t.reason === "random" && yearOf(s.program.timeZone, t) === year);
  const count = (sub: Substance) => random.filter((t) => t.substance === sub && counted(t) && t.result !== "cancelled").length;
  return {
    year,
    rates,
    ratesConfirmed: confirmed,
    averagePool,
    required: { drug: Math.ceil(rates.drug * averagePool), alcohol: Math.ceil(rates.alcohol * averagePool) },
    completed: { drug: count("drug"), alcohol: count("alcohol") },
    outstanding: random.filter(isOpen),
    periodsDrawn: draws.map((d) => d.period).sort(),
  };
}

export interface DrawPlan {
  poolIds: string[];
  selections: { personId: string; substance: Substance }[];
}

/**
 * Choose this period's random selections. Every pool member has an equal chance in every
 * draw, and selections are spread across the four quarters. `pick(n)` returns a uniform
 * integer in [0, n); production passes crypto.randomInt.
 */
export function planDraw(s: State, year: number, period: number, today: IsoDate, pick: (n: number) => number): DrawPlan {
  const members = pool(s, today);
  const prior = s.draws.filter((d) => d.year === year);
  const average = mean([...prior.map((d) => d.poolIds.length), members.length]);
  const { rates } = ratesFor(year);
  const cancelled = new Set(s.tests.filter((t) => t.result === "cancelled").map((t) => t.id));
  const selections: DrawPlan["selections"] = [];
  for (const substance of ["drug", "alcohol"] as const) {
    const annual = Math.ceil(rates[substance] * average);
    const target = Math.ceil((annual * period) / 4);
    const already = prior.flatMap((d) => d.selections).filter((x) => x.substance === substance && !cancelled.has(x.testId)).length;
    const n = Math.max(0, Math.min(members.length, target - already));
    const bag = members.map((m) => m.id);
    for (let i = 0; i < n; i++) selections.push({ personId: bag.splice(pick(bag.length), 1)[0]!, substance });
  }
  return { poolIds: members.map((m) => m.id), selections };
}

// ── Event clocks ─────────────────────────────────────────────────────────────

const HOUR = 3_600_000;

export interface Deadlines {
  /** After this instant a late alcohol test needs a written reason. */
  alcoholRecordAt: IsoInstant;
  /** After this instant alcohol testing must stop. */
  alcoholCeaseAt: IsoInstant;
  /** Post-accident only: after this instant drug testing is too late. */
  drugCeaseAt?: IsoInstant;
}

export function deadlines(i: Incident): Deadlines {
  const t = new Date(i.occurredAt).getTime();
  const at = (h: number) => new Date(t + h * HOUR).toISOString();
  return {
    alcoholRecordAt: at(RULES.alcoholRecordHours),
    alcoholCeaseAt: at(RULES.alcoholCeaseHours),
    drugCeaseAt: i.kind === "post_accident" ? at(RULES.postAccidentDrugHours) : undefined,
  };
}

/** Returns a message when a collection time cannot be recorded for this event's test. */
export function collectionProblem(i: Incident, substance: Substance, collectedAt: IsoInstant, delayReason?: string): string | undefined {
  const d = deadlines(i);
  if (collectedAt < i.occurredAt) return "Collection time is before the event";
  if (substance === "alcohol") {
    if (collectedAt > d.alcoholCeaseAt) return `Alcohol testing must stop ${RULES.alcoholCeaseHours} hours after the event. Record why the test was not administered instead`;
    if (collectedAt > d.alcoholRecordAt && !delayReason?.trim())
      return `Record why the alcohol test was administered more than ${RULES.alcoholRecordHours} hours after the event`;
  } else if (d.drugCeaseAt && collectedAt > d.drugCeaseAt) {
    return `A post-accident drug test must be collected within ${RULES.postAccidentDrugHours} hours. Record why the test was not administered instead`;
  }
  return undefined;
}

// ── Reports to the FAA ───────────────────────────────────────────────────────

export interface Obligation {
  testId: string;
  personId: string;
  to: "fas" | "faa";
  label: string;
  dueOn: IsoDate;
  doneOn?: IsoDate;
}

export function obligations(s: State): Obligation[] {
  const out: Obligation[] = [];
  for (const t of s.tests) {
    if (!isViolation(t)) continue;
    const p = s.people.find((x) => x.id === t.personId);
    if (!p) continue;
    const dueOn = addWorkingDays(t.verifiedOn ?? t.orderedOn, RULES.reportWorkingDays);
    const what = t.result === "refusal" ? "refusal to test" : t.substance === "drug" ? "verified positive drug result" : "alcohol violation";
    if (p.medical) out.push({ testId: t.id, personId: p.id, to: "fas", label: `Report ${what} to the Federal Air Surgeon`, dueOn, doneOn: t.reportedFasOn });
    if (p.airman && t.result === "refusal")
      out.push({ testId: t.id, personId: p.id, to: "faa", label: "Report refusal by a certificate holder to the FAA Drug Abatement Division", dueOn, doneOn: t.reportedFaaOn });
  }
  return out;
}

// ── Records and retention ────────────────────────────────────────────────────

export interface RecordItem {
  title: string;
  cls: string;
  basis: string;
  date: IsoDate;
  /** Undefined: keep while the program is active. */
  keepUntil?: IsoDate;
}

export function records(s: State): RecordItem[] {
  const tz = s.program.timeZone;
  const name = (id: string) => s.people.find((p) => p.id === id)?.name ?? "Unknown";
  const out: RecordItem[] = [];
  const keep = (title: string, cls: string, basis: string, date: IsoDate, years: number) =>
    out.push({ title, cls, basis, date, keepUntil: addYears(date, years) });

  for (const t of s.tests) {
    const who = name(t.personId);
    const label = `${TEST_REASONS[t.reason]} ${t.substance} test: ${who}`;
    if (t.notAdministeredReason) {
      keep(`${label} (not administered)`, "Testing decision", "14 CFR 120.219(a)(2)(ii)", t.orderedOn, RULES.keep.process);
      continue;
    }
    if (!t.result) continue;
    const date = t.verifiedOn ?? (t.collectedAt ? dateIn(tz, t.collectedAt) : t.orderedOn);
    if (t.result === "positive" || t.result === "refusal" || t.result === "low") {
      const cls = t.result === "refusal" ? "Refusal" : t.result === "low" ? "Alcohol result 0.02 or greater" : t.substance === "drug" ? "Verified positive drug result" : "Alcohol result 0.02 or greater";
      keep(label, cls, "49 CFR 40.333(a)(1)", date, RULES.keep.violation);
    } else {
      const pilot = s.people.find((p) => p.id === t.personId)?.functions.includes("flight_crew");
      if (pilot) keep(label, "Negative or cancelled result (pilot record)", "49 CFR 40.333(a)(4); pilot records exception", date, RULES.keep.pilotNegative);
      else keep(label, "Negative or cancelled result", "49 CFR 40.333(a)(4)", date, RULES.keep.negative);
    }
    if (t.reportedFasOn) keep(`Report to the Federal Air Surgeon: ${who}`, "FAA report", "14 CFR 120.113(d)", t.reportedFasOn, RULES.keep.report);
    if (t.reportedFaaOn) keep(`Report of refusal to the FAA: ${who}`, "FAA report", "14 CFR 120.111(d)", t.reportedFaaOn, RULES.keep.report);
  }
  for (const p of s.people) {
    if (p.consentOn) keep(`Consent and prior-employer request: ${p.name}`, "Prior-employer inquiry", "49 CFR 40.25(g), 40.333(a)(2)", p.firstDutyOn ?? p.consentOn, RULES.keep.priorEmployer);
    if (p.goodFaithOn) keep(`Good-faith effort record: ${p.name}`, "Prior-employer inquiry", "49 CFR 40.25(d), (g)", p.firstDutyOn ?? p.goodFaithOn, RULES.keep.priorEmployer);
    for (const tr of p.training)
      keep(`${tr.kind === "employee" ? "Employee training" : tr.kind === "supervisor_drug" ? "Supervisor drug training" : "Supervisor alcohol training"}: ${p.name}`, "Training record", "14 CFR 120.115(c), 120.219(a)(2)(ii)", tr.on, RULES.keep.training);
  }
  for (const d of s.draws) keep(`Random selection list, ${d.year} Q${d.period}`, "Random selection record", "14 CFR 120.219(a)(2)(ii)", dateIn(tz, d.drawnAt), RULES.keep.process);
  for (const i of s.incidents)
    keep(`${i.kind === "post_accident" ? "Post-accident" : "Reasonable-cause"} determination: ${name(i.personId)}`, "Testing decision", "14 CFR 120.219(a)(2)(ii)", dateIn(tz, i.occurredAt), RULES.keep.process);
  for (const f of s.filings) keep(`Annual report for ${f.year}`, "Annual report", "14 CFR 120.111, 120.219", f.filedOn, RULES.keep.report);
  out.push({
    title: s.program.registrationKind === "a449" ? `OpSpec A449: ${s.program.registrationRef}` : `Program registration: ${s.program.registrationRef}`,
    cls: "Program document",
    basis: "14 CFR 120.117, 120.225",
    date: "",
  });
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ── Annual report ────────────────────────────────────────────────────────────

const MIS_ROWS: [TestReason, Substance][] = [
  ["pre_employment", "drug"],
  ["random", "drug"],
  ["random", "alcohol"],
  ["post_accident", "drug"],
  ["post_accident", "alcohol"],
  ["reasonable_cause", "drug"],
  ["reasonable_cause", "alcohol"],
  ["return_to_duty", "drug"],
  ["return_to_duty", "alcohol"],
  ["follow_up", "drug"],
  ["follow_up", "alcohol"],
];

export function misCounts(s: State, year: number): MisRow[] {
  const inYear = s.tests.filter((t) => counted(t) && yearOf(s.program.timeZone, t) === year);
  return MIS_ROWS.map(([reason, substance]) => {
    const rows = inYear.filter((t) => t.reason === reason && t.substance === substance);
    return {
      reason,
      substance,
      tests: rows.length,
      positive: rows.filter((t) => t.result === "positive").length,
      refusals: rows.filter((t) => t.result === "refusal").length,
      cancelled: rows.filter((t) => t.result === "cancelled").length,
    };
  });
}

export interface MisStatus {
  year: number;
  required: boolean;
  reason: string;
  coveredOnJan1: number;
  dueOn: IsoDate;
  filedOn?: IsoDate;
}

export function misStatus(s: State, year: number): MisStatus {
  const coveredOnJan1 = s.people.filter((p) => isActive(p, `${year}-01-01`)).length;
  const reason =
    s.program.operation === "part121"
      ? "Required: Part 121 certificate holder"
      : coveredOnJan1 >= RULES.misEmployeeThreshold
        ? `Required: ${coveredOnJan1} covered employees on January 1`
        : s.program.misNotified
          ? "Required: the FAA sent written notice"
          : `Not required: under ${RULES.misEmployeeThreshold} covered employees on January 1 and no FAA notice`;
  return {
    year,
    required: reason.startsWith("Required"),
    reason,
    coveredOnJan1,
    dueOn: `${year + 1}-03-15`,
    filedOn: s.filings.find((f) => f.year === year)?.filedOn,
  };
}

// ── Open items and the self-audit ────────────────────────────────────────────

export type View = "dashboard" | "roster" | "random" | "events" | "records" | "contractors" | "audit" | "mis";

export interface OpenItem {
  severity: "critical" | "warning";
  title: string;
  detail: string;
  view: View;
}

const trained = (p: Person, kind: "supervisor_drug" | "supervisor_alcohol") =>
  p.training.filter((t) => t.kind === kind).reduce((m, t) => m + t.minutes, 0) >= RULES.supervisorMinutes;

export const contractorUncovered = (c: { functions: unknown[]; coverage: string; evidenceRef?: string }) =>
  c.functions.length > 0 && (c.coverage === "none" || (c.coverage === "own_program" && !c.evidenceRef?.trim()));

export function openItems(s: State, now: Date): OpenItem[] {
  const tz = s.program.timeZone;
  const today = todayIn(tz, now);
  const year = Number(today.slice(0, 4));
  const items: OpenItem[] = [];
  const current = s.people.filter((p) => !p.separatedOn || p.separatedOn > today);

  for (const p of current) {
    const c = clearance(p, s.tests, today);
    if (!c.cleared) {
      const working = isActive(p, today);
      items.push({
        severity: "critical",
        title: working ? `${p.name} is performing safety-sensitive duty without clearance` : `${p.name} is blocked from safety-sensitive duty`,
        detail: c.blockers.join(". ") + ".",
        view: "roster",
      });
    }
    for (const w of c.warnings) items.push({ severity: "warning", title: p.name, detail: w + ".", view: "roster" });
    if (p.supervisor && !(trained(p, "supervisor_drug") && trained(p, "supervisor_alcohol")))
      items.push({
        severity: "warning",
        title: `${p.name} lacks supervisor training`,
        detail: `Supervisors who make determinations need ${RULES.supervisorMinutes} minutes of training on drug indicators and ${RULES.supervisorMinutes} on alcohol indicators.`,
        view: "roster",
      });
    if (isActive(p, today) && !p.training.some((t) => t.kind === "employee"))
      items.push({ severity: "warning", title: `${p.name} has no employee training record`, detail: "Record the initial drug and alcohol program training.", view: "roster" });
  }

  const rs = randomStatus(s, year, today);
  const quarter = quarterOf(today);
  if (pool(s, today).length && !rs.periodsDrawn.includes(quarter))
    items.push({ severity: "warning", title: `Random draw for Q${quarter} not run`, detail: "Selections must be spread through the year.", view: "random" });
  for (const t of rs.outstanding) {
    const who = s.people.find((p) => p.id === t.personId)?.name ?? "Unknown";
    items.push({ severity: "warning", title: `Random ${t.substance} test not collected: ${who}`, detail: `Selected ${t.orderedOn}. Notify the employee and send for collection, or record why no test was administered.`, view: "random" });
  }

  for (const i of s.incidents) {
    if (!i.testingRequired) continue;
    const d = deadlines(i);
    const who = s.people.find((p) => p.id === i.personId)?.name ?? "Unknown";
    for (const [id, substance, cease] of [
      [i.drugTestId, "drug", d.drugCeaseAt],
      [i.alcoholTestId, "alcohol", d.alcoholCeaseAt],
    ] as const) {
      const t = s.tests.find((x) => x.id === id);
      if (!t || !isOpen(t)) continue;
      const late = cease && now.toISOString() > cease;
      items.push({
        severity: "critical",
        title: late ? `${substance === "drug" ? "Drug" : "Alcohol"} test window closed: ${who}` : `${substance === "drug" ? "Drug" : "Alcohol"} test clock running: ${who}`,
        detail: late ? "Record why the test was not administered." : cease ? `Collect by ${formatIn(tz, cease)}.` : "Collect as soon as possible.",
        view: "events",
      });
    }
  }

  for (const o of obligations(s)) {
    if (o.doneOn) continue;
    const who = s.people.find((p) => p.id === o.personId)?.name ?? "Unknown";
    items.push({ severity: "critical", title: `${o.label}: ${who}`, detail: `Due ${o.dueOn}${o.dueOn < today ? " (overdue)" : ""}.`, view: "roster" });
  }

  for (const c of s.contractors)
    if (contractorUncovered(c))
      items.push({
        severity: "critical",
        title: `${c.name} has no testing coverage on file`,
        detail: "Performs safety-sensitive work. Record its own program reference or cover its staff in this pool.",
        view: "contractors",
      });

  const mis = misStatus(s, year - 1);
  if (mis.required && !mis.filedOn)
    items.push({ severity: mis.dueOn < today ? "critical" : "warning", title: `Annual report for ${mis.year} not filed`, detail: `Due ${mis.dueOn}.`, view: "mis" });

  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

export interface AuditItem {
  id: string;
  question: string;
  status: "pass" | "finding" | "progress" | "na";
  detail: string;
  ref: string;
}

/** A self-audit scored from the records. It mirrors the areas an FAA Drug Abatement inspection reviews; it is not the FAA's guide. */
export function audit(s: State, now: Date): AuditItem[] {
  const today = todayIn(s.program.timeZone, now);
  const year = Number(today.slice(0, 4));
  const active = pool(s, today);
  const names = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");
  const check = (id: string, question: string, ref: string, bad: { name: string }[], ok: string): AuditItem => ({
    id,
    question,
    ref,
    status: bad.length ? "finding" : "pass",
    detail: bad.length ? names(bad) : ok,
  });

  const rs = randomStatus(s, year, today);
  const random = (sub: Substance): AuditItem => ({
    id: `random-${sub}`,
    question: `Random ${sub} testing meets the annual minimum rate`,
    ref: sub === "drug" ? "14 CFR 120.109(b)" : "14 CFR 120.217(c)",
    status: rs.completed[sub] >= rs.required[sub] ? "pass" : "progress",
    detail: `${rs.completed[sub]} of ${rs.required[sub]} collected in ${year}${rs.ratesConfirmed ? "" : " (rate for this year not confirmed in the rule table)"}`,
  });

  const overdue = obligations(s).filter((o) => !o.doneOn);
  const late = s.tests.filter((t) => !t.result && !t.collectedAt && !t.notAdministeredReason && t.eventId);
  const mis = misStatus(s, year - 1);

  return [
    { id: "registration", question: "Program registered with the FAA", ref: "14 CFR 120.117, 120.225", status: s.program.registrationRef.trim() ? "pass" : "finding", detail: s.program.registrationRef.trim() || "No registration reference recorded" },
    { id: "der", question: "Designated employer representative is the employer's own", ref: "49 CFR 40.3, 40.355", status: "pass", detail: "Set at enrollment; service agents cannot hold this role" },
    check("clearance", "No one performs safety-sensitive duty without clearance", "14 CFR 120.109(a); 49 CFR 40.25", active.filter((p) => !clearance(p, s.tests, today).cleared), "All current staff cleared"),
    check("pre-employment", "Verified negative pre-employment result received before first duty", "14 CFR 120.109(a)", s.people.filter((p) => dutyBeforeResult(p, s.tests)), "All records in order"),
    check("prior-employer", "Prior-employer records obtained or a good-faith effort documented", "49 CFR 40.25", active.filter((p) => !priorRecordsComplete(p) && !p.goodFaithOn), "All obtained or documented"),
    random("drug"),
    random("alcohol"),
    { id: "random-collected", question: "Every random selection was tested or explained", ref: "14 CFR 120.109(b)", status: rs.outstanding.length ? "progress" : "pass", detail: rs.outstanding.length ? `${rs.outstanding.length} outstanding` : "None outstanding" },
    { id: "event-tests", question: "Post-accident and reasonable-cause tests completed or explained", ref: "14 CFR 120.109(c)-(d), 120.217(b), (d)", status: late.length ? "progress" : "pass", detail: late.length ? `${late.length} open` : "None open" },
    check("supervisor-training", "Supervisor training documented", "14 CFR 120.115(c), 120.223(b)", s.people.filter((p) => p.supervisor && isActive(p, today) && !(trained(p, "supervisor_drug") && trained(p, "supervisor_alcohol"))), "All supervisors trained"),
    check("employee-training", "Employee training documented", "14 CFR 120.115(c), 120.223(a)", active.filter((p) => !p.training.some((t) => t.kind === "employee")), "All covered staff"),
    check("contractors", "Contractors doing safety-sensitive work are covered", "14 CFR 120.105, 120.215", s.contractors.filter(contractorUncovered), "All covered"),
    { id: "reports", question: "Required reports sent to the FAA", ref: "14 CFR 120.111(d), 120.113(d), 120.221", status: overdue.length ? "finding" : "pass", detail: overdue.length ? `${overdue.length} not sent` : "None outstanding" },
    {
      id: "mis",
      question: `Annual report for ${mis.year} filed`,
      ref: "14 CFR 120.119, 120.219(b)",
      status: !mis.required ? "na" : mis.filedOn ? "pass" : mis.dueOn < today ? "finding" : "progress",
      detail: !mis.required ? mis.reason : mis.filedOn ? `Filed ${mis.filedOn}` : `Due ${mis.dueOn}`,
    },
  ];
}

export const functionNames = (codes: readonly string[]) => codes.map((c) => FUNCTIONS[c as keyof typeof FUNCTIONS] ?? c).join(", ");
