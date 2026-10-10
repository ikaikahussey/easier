import { allocate, type Cents } from "@/core/money";
import { NONPROFIT_CATALOG } from "@/domains/nonprofit/lines";
import { lineAmount, type NonprofitLedger } from "@/domains/nonprofit/ledger";

export type FunctionalColumn = "program" | "management" | "fundraising";
export type Split = Record<FunctionalColumn, number>;

/** Lines that belong wholly to one function regardless of the staff-time split. */
const DIRECT: Partial<Record<string, FunctionalColumn>> = {
  "IX.1": "program",
  "IX.2": "program",
  "IX.3": "program",
  "IX.4": "program",
  "IX.11a": "management",
  "IX.11c": "management",
  "IX.11f": "management",
  "IX.11e": "fundraising",
};

export interface FunctionalRow {
  code: string;
  label: string;
  total: Cents;
  program: Cents;
  management: Cents;
  fundraising: Cents;
}

/** Form 990 Part IX columns (A)–(D). Shared lines use the organization's staff-time split. */
export function functionalExpenses(ledger: NonprofitLedger, split: Split): FunctionalRow[] {
  // An invalid split is reported by a rule; allocate to program meanwhile so the draft still renders.
  const valid = split.program + split.management + split.fundraising > 0;
  const shared: Split = valid ? split : { program: 1, management: 0, fundraising: 0 };
  return NONPROFIT_CATALOG.lines
    .filter((l) => l.code.startsWith("IX.") && lineAmount(ledger, l.code) !== 0)
    .map((l) => {
      const total = lineAmount(ledger, l.code);
      const direct = DIRECT[l.code];
      const weights: Split = direct ? { program: 0, management: 0, fundraising: 0, [direct]: 1 } : shared;
      return { code: l.code, label: l.label, total, ...allocate(total, weights) };
    });
}

export const columnTotals = (rows: FunctionalRow[]) =>
  rows.reduce(
    (t, r) => ({
      total: t.total + r.total,
      program: t.program + r.program,
      management: t.management + r.management,
      fundraising: t.fundraising + r.fundraising,
    }),
    { total: 0, program: 0, management: 0, fundraising: 0 },
  );
