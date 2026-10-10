import { adaptRules, type Rule } from "@/core/rules";
import { ledgerRules } from "@/core/ledger/rules";
import { formatUsd } from "@/core/money";
import { NONPROFIT_CATALOG } from "./lines";
import type { NonprofitLedger } from "./ledger";

/** Rules for any product whose draft carries a nonprofit ledger. */
export function nonprofitLedgerRules<C>(select: (ctx: C) => NonprofitLedger): Rule<C>[] {
  const own: Rule<NonprofitLedger>[] = [
    {
      id: "nonprofit.balance_sheet_ties",
      severity: "error",
      ref: "Form 990 Part X, lines 16 and 33",
      description: "Total assets equal total liabilities plus ending net assets",
      check: ({ totals }) =>
        totals.assets !== totals.liabilities + totals.endingNetAssets
          ? `Assets ${formatUsd(totals.assets)} ≠ liabilities ${formatUsd(totals.liabilities)} + net assets ${formatUsd(
              totals.endingNetAssets,
            )}`
          : undefined,
    },
    {
      id: "nonprofit.opening_balance_equity",
      severity: "warning",
      description: "Opening Balance Equity is cleared to net assets",
      check: ({ tb }) =>
        tb.accounts
          .filter((a) => /opening balance equity/i.test(a.name) && a.balance !== 0)
          .map((a) => ({ message: `Opening Balance Equity holds ${formatUsd(a.balance)}; close it to net assets`, subject: a.id })),
    },
    {
      id: "nonprofit.payroll_taxes",
      severity: "warning",
      ref: "Form 990 Part IX, lines 7 and 10",
      description: "Payroll taxes are recorded when wages are paid",
      check: ({ lines }) =>
        ((lines["IX.5"] ?? 0) + (lines["IX.7"] ?? 0) > 0 && !lines["IX.10"]
          ? "Wages are recorded but payroll taxes are zero; confirm whether staff are contractors or taxes are misclassified"
          : undefined),
    },
  ];
  return [
    ...adaptRules(ledgerRules, (c: C) => {
      const l = select(c);
      return { tb: l.tb, mappings: l.mappings, catalog: NONPROFIT_CATALOG };
    }),
    ...adaptRules(own, select),
  ];
}
