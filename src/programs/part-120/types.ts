/**
 * Part 120 Compliance Desk: an ongoing compliance program, not an engagement.
 * The employer's designated employer representative (DER) owns every decision here;
 * easier.company acts as a service agent and never as the DER (49 CFR 40.355).
 */

/** Safety-sensitive functions, 14 CFR 120.105 and 120.215. */
export const FUNCTIONS = {
  flight_crew: "Flight crewmember",
  flight_attendant: "Flight attendant",
  flight_instruction: "Flight instruction",
  dispatcher: "Aircraft dispatcher",
  maintenance: "Aircraft maintenance or preventive maintenance",
  ground_security: "Ground security coordinator",
  aviation_screening: "Aviation screening",
  atc: "Air traffic control",
  ops_control: "Operations control specialist",
} as const;
export type FunctionCode = keyof typeof FUNCTIONS;

export const OPERATIONS = {
  part135: "Part 135 certificate holder",
  part121: "Part 121 certificate holder",
  part91_147: "Air tour operator (14 CFR 91.147)",
  part145: "Part 145 repair station",
  contractor: "Contractor",
} as const;
export type Operation = keyof typeof OPERATIONS;

export const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Pacific/Guam",
  "UTC",
] as const;

/** Program settings. Not confidential; stored in plain columns. */
export interface Program {
  orgId: string;
  operation: Operation;
  /** OpSpec A449 paragraph or a Drug Abatement registration, 14 CFR 120.117 and 120.225. */
  registrationKind: "a449" | "registration";
  registrationRef: string;
  derUserId: string;
  timeZone: string;
  /** The FAA has notified this employer in writing to file the annual report (14 CFR 120.119). */
  misNotified: boolean;
}

export type IsoDate = string; // YYYY-MM-DD
export type IsoInstant = string; // full ISO timestamp, UTC

export interface PriorEmployer {
  name: string;
  requestedOn?: IsoDate;
  receivedOn?: IsoDate;
  /** The response reported a violation; return-to-duty evidence is then required (49 CFR 40.25(e)). */
  violation?: boolean;
}

export type TrainingKind = "employee" | "supervisor_drug" | "supervisor_alcohol";
export interface Training {
  kind: TrainingKind;
  on: IsoDate;
  minutes: number;
}

export interface Person {
  name: string;
  title: string;
  functions: FunctionCode[];
  /** Makes reasonable-cause and reasonable-suspicion determinations. */
  supervisor: boolean;
  /** Holds, or would be required to hold, a Part 67 airman medical certificate. */
  medical: boolean;
  /** Holds a certificate issued under Part 61, 63, or 65. */
  airman: boolean;
  /** Works for a contractor but is covered in this employer's program. */
  contractorId?: string;
  hiredOn?: IsoDate;
  /** Written consent to the prior-employer records request (49 CFR 40.25(a)). */
  consentOn?: IsoDate;
  consentRefused?: boolean;
  /** The 40.25(j) question: any positive or refusal on a pre-employment test in the past two years. */
  askedOn?: IsoDate;
  admitted?: boolean;
  /** Declared no DOT-regulated employer in the two years before the application or transfer. */
  noPriorDot?: boolean;
  priorEmployers: PriorEmployer[];
  /** Documented good-faith effort to obtain prior-employer records (49 CFR 40.25(d)). */
  goodFaithOn?: IsoDate;
  goodFaithNote?: string;
  firstDutyOn?: IsoDate;
  separatedOn?: IsoDate;
  /** Return-to-duty process completed after a violation; evidence is kept outside this record. */
  returnToDutyOn?: IsoDate;
  training: Training[];
}

export type TestReason = "pre_employment" | "random" | "post_accident" | "reasonable_cause" | "return_to_duty" | "follow_up";
export const TEST_REASONS: Record<TestReason, string> = {
  pre_employment: "Pre-employment",
  random: "Random",
  post_accident: "Post-accident",
  reasonable_cause: "Reasonable cause or suspicion",
  return_to_duty: "Return-to-duty",
  follow_up: "Follow-up",
};

export type Substance = "drug" | "alcohol";
/** `low` is an alcohol concentration of 0.02 to 0.039: not a violation, but a five-year record. */
export type TestResult = "negative" | "positive" | "refusal" | "cancelled" | "low";

export interface Test {
  personId: string;
  reason: TestReason;
  substance: Substance;
  orderedOn: IsoDate;
  collectedAt?: IsoInstant;
  result?: TestResult;
  /** Date the medical review officer verified a drug result, or the alcohol result was confirmed. */
  verifiedOn?: IsoDate;
  /** Why a required test was not administered. */
  notAdministeredReason?: string;
  /** Why an alcohol test was administered more than two hours after the trigger. */
  delayReason?: string;
  eventId?: string;
  drawId?: string;
  /** Report to the Federal Air Surgeon (14 CFR 120.113(d), 120.221(c)). */
  reportedFasOn?: IsoDate;
  /** Report of a refusal to the FAA (14 CFR 120.111(d), 120.221(d)). */
  reportedFaaOn?: IsoDate;
}

export interface Draw {
  year: number;
  /** Quarter, 1 to 4. */
  period: number;
  drawnAt: IsoInstant;
  /** Everyone in the pool when the draw ran. */
  poolIds: string[];
  selections: { personId: string; substance: Substance; testId: string }[];
  method: string;
}

export type EventKind = "post_accident" | "reasonable_cause";
export interface Incident {
  kind: EventKind;
  personId: string;
  occurredAt: IsoInstant;
  note: string;
  /**
   * Post-accident only: the employee's performance contributed to the accident or cannot be
   * completely discounted as a contributing factor. When false, no test is required and the
   * decision itself is the record.
   */
  testingRequired: boolean;
  drugTestId?: string;
  alcoholTestId?: string;
}

export type Coverage = "own_program" | "our_pool" | "none";
export interface Contractor {
  name: string;
  work: string;
  /** Empty when the work is not safety-sensitive. */
  functions: FunctionCode[];
  coverage: Coverage;
  /** The contractor's own A449 paragraph or registration reference. */
  evidenceRef?: string;
  evidenceOn?: IsoDate;
}

export interface MisFiling {
  year: number;
  filedOn: IsoDate;
  /** The company official who certified the report (14 CFR 120.119, 120.219(b)). */
  certifiedBy: string;
  counts: MisRow[];
}

export interface MisRow {
  reason: TestReason;
  substance: Substance;
  tests: number;
  positive: number;
  refusals: number;
  cancelled: number;
}

export type WithId<T> = T & { id: string };

/** Everything the rules read, decrypted, for one employer. */
export interface State {
  program: Program;
  people: WithId<Person>[];
  tests: WithId<Test>[];
  draws: WithId<Draw>[];
  incidents: WithId<Incident>[];
  contractors: WithId<Contractor>[];
  filings: WithId<MisFiling>[];
}

export type RecordKind = "person" | "test" | "draw" | "incident" | "contractor" | "filing";
