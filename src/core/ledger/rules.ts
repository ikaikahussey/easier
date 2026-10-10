import type { Rule } from "../rules";
import { formatUsd } from "../money";
import type { TrialBalance } from "./trial-balance";
import { lineByCode, type LineCatalog, type Mapping } from "./catalog";

export interface LedgerContext {
  tb: TrialBalance;
  mappings: Mapping[];
  catalog: LineCatalog;
}

const SUSPENSE = /ask my accountant|uncategori[sz]ed|suspense|clearing|to be classified/i;

/** Checks shared by every product that ingests a trial balance. */
export const ledgerRules: Rule<LedgerContext>[] = [
  {
    id: "ledger.balanced",
    severity: "error",
    description: "Total debits equal total credits",
    check: ({ tb }) =>
      tb.totalDebit !== tb.totalCredit
        ? `Trial balance is out of balance: debits ${formatUsd(tb.totalDebit)}, credits ${formatUsd(tb.totalCredit)}`
        : undefined,
  },
  {
    id: "ledger.import_warnings",
    severity: "error",
    description: "Every row of the trial balance was imported",
    check: ({ tb }) => tb.warnings,
  },
  {
    id: "ledger.suspense",
    severity: "error",
    description: "No balances left in suspense or uncategorized accounts",
    check: ({ tb }) =>
      tb.accounts
        .filter((a) => a.balance !== 0 && SUSPENSE.test(a.name))
        .map((a) => ({
          message: `"${a.name}" holds ${formatUsd(a.balance)}; reclassify before reporting`,
          subject: a.id,
        })),
  },
  {
    id: "ledger.unclassified",
    severity: "error",
    description: "Every account with a balance is classified by rule, AI, or reviewer",
    check: ({ tb, mappings }) =>
      mappings
        .filter((m) => m.source === "fallback" && tb.accounts.find((a) => a.id === m.accountId)?.balance)
        .map((m) => ({
          message: `"${tb.accounts.find((a) => a.id === m.accountId)!.name}" could not be classified; confirm the line`,
          subject: m.accountId,
        })),
  },
  {
    id: "ledger.ai_classified",
    severity: "warning",
    description: "AI classifications are confirmed by the reviewer",
    check: ({ tb, mappings, catalog }) =>
      mappings
        .filter((m) => m.source === "ai")
        .map((m) => ({
          message: `"${tb.accounts.find((a) => a.id === m.accountId)!.name}" → ${
            lineByCode(catalog, m.line)?.label ?? m.line
          } (AI, ${Math.round(m.confidence * 100)}% confidence)`,
          subject: m.accountId,
        })),
  },
];
