import type { FormSection } from "@/core/fields";
import { formatUsd, type Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import type { Rule } from "@/core/rules";
import type { NonprofitLedger } from "@/domains/nonprofit/ledger";
import { lineAmount } from "@/domains/nonprofit/ledger";
import type { FunctionalRow } from "../allocation";
import type { FormType } from "../form-type";
import type { Form990Intake } from "../intake";

/** Intake amounts are entered in dollars; everything computed is in cents. */
export const cents = (dollars: number | undefined): Cents => Math.round((dollars ?? 0) * 100);

/** Everything a schedule may read. Outputs of schedules built earlier are in `outputs`. */
export interface ScheduleFacts {
  intake: Form990Intake;
  ledger: NonprofitLedger;
  formType: FormType;
  /** First calendar year of the tax year (the year printed on the form). */
  taxYear: number;
  functional: FunctionalRow[];
  totalExpenses: Cents;
  /** Triggered schedule parts, e.g. "G-II" (from the Part IV checklist). */
  parts: Set<string>;
  /** Event contributions moved from Part VIII line 8a to line 1c. */
  eventSplit: Cents;
  outputs: Partial<Record<string, unknown>>;
}

export interface ScheduleRuleContext<O> {
  facts: ScheduleFacts;
  out: O;
}

/**
 * One IRS schedule: the client questions it needs, how its figures are computed,
 * the checks a reviewer must clear, and the worksheet sections it renders.
 */
export interface ScheduleModule<O = unknown> {
  schedule: string;
  title: string;
  /** Intake sections shown to the client (optional fields; rules enforce them when the schedule applies). */
  intake: FormSection[];
  build: (facts: ScheduleFacts) => O;
  rules: Rule<ScheduleRuleContext<O>>[];
  render: (out: O, facts: ScheduleFacts) => ReviewSection[];
}

export const defineSchedule = <O>(m: ScheduleModule<O>): ScheduleModule<O> => m;

export const amt = (f: ScheduleFacts, ...codes: string[]): Cents =>
  codes.reduce((t, c) => t + lineAmount(f.ledger, c), 0);

/** Total contributions, Form 990 Part VIII line 1h (Form 990-EZ line 1). */
export const CONTRIBUTION_LINES = ["VIII.1a", "VIII.1b", "VIII.1c", "VIII.1d", "VIII.1e", "VIII.1f"];

export const usd = (c: Cents | undefined) => (c === undefined ? "—" : formatUsd(c));

/** Percent to two decimals, as Schedule A reports it. */
export const pct = (num: Cents, den: Cents, digits = 2) =>
  den === 0 ? 0 : Math.round((num / den) * 100 * 10 ** digits) / 10 ** digits;

export const yesNo = (b: boolean | undefined) => (b === undefined ? "—" : b ? "Yes" : "No");

/** Tolerance for comparing intake detail with ledger totals: $1 of rounding. */
export const TIE = 100;
