import { z } from "zod";
import type { AiRunner, AiTask } from "@/core/ai/llm";
import { classifyAccounts, linesForType, rollup, type Mapping } from "@/core/ledger/catalog";
import { parseTrialBalance, type Account, type TrialBalance } from "@/core/ledger/trial-balance";
import type { Cents } from "@/core/money";
import type { BuildInput, DocumentKind, Editable } from "@/core/product";
import { isNettedLine, NONPROFIT_CATALOG, nonprofitLine } from "./lines";

export const TRIAL_BALANCE: DocumentKind = {
  kind: "trial_balance",
  label: "Trial balance (CSV)",
  help: "Export from QuickBooks, Xero, or Aplos: Reports → Trial Balance → Export to CSV. Include account number, name, type, debit, and credit.",
  accept: ".csv,text/csv",
  required: true,
  parse: parseTrialBalance,
};

const classifyOutput = z.object({
  mappings: z.array(
    z.object({
      accountId: z.string(),
      line: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

type ClassifyInput = { accounts: Pick<Account, "id" | "name" | "type">[] };

export const classifyNonprofitAccounts: AiTask<ClassifyInput, z.infer<typeof classifyOutput>> = {
  id: "nonprofit.classify_accounts",
  version: 1,
  system:
    "You are a nonprofit accountant classifying general ledger accounts into IRS Form 990 lines. " +
    "Choose only from the allowed lines for each account's type. Give a confidence between 0 and 1 " +
    "and a one-sentence reason. Use low confidence when the account name is ambiguous.",
  prompt: ({ accounts }) => {
    const types = [...new Set(accounts.map((a) => a.type))];
    const allowed = types
      .map((t) => `${t}:\n${linesForType(NONPROFIT_CATALOG, t).map((l) => `  ${l.code} — ${l.label}`).join("\n")}`)
      .join("\n");
    const list = accounts.map((a) => `- id=${a.id} type=${a.type} name="${a.name}"`).join("\n");
    return `Allowed lines by account type:\n${allowed}\n\nAccounts to classify:\n${list}`;
  },
  schema: classifyOutput,
  // Without a model, unmatched accounts stay unclassified and are routed to the reviewer.
  fallback: () => ({ mappings: [] }),
};

export interface NonprofitLedger {
  tb: TrialBalance;
  mappings: Mapping[];
  /** Natural-balance totals by catalog line code. */
  lines: Record<string, Cents>;
  totals: {
    grossRevenue: Cents;
    nettedExpenses: Cents;
    functionalExpenses: Cents;
    assets: Cents;
    liabilities: Cents;
    beginningNetAssets: Cents;
    endingNetAssets: Cents;
  };
}

export async function loadNonprofitLedger(
  input: BuildInput<unknown>,
  ai: AiRunner,
): Promise<{ ledger: NonprofitLedger; editable: Editable }> {
  const tb = input.documents[TRIAL_BALANCE.kind] as TrialBalance | undefined;
  if (!tb) throw new Error("A trial balance is required");

  const mappings = await classifyAccounts(tb.accounts, NONPROFIT_CATALOG, {
    overrides: input.overrides.mappings,
    ai: async (accounts) =>
      (
        await ai.run(classifyNonprofitAccounts, {
          accounts: accounts.map(({ id, name, type }) => ({ id, name, type })),
        })
      ).mappings,
  });

  const lines = Object.fromEntries(rollup(tb.accounts, mappings));
  const sumWhere = (pred: (code: string) => boolean) =>
    Object.entries(lines).reduce((t, [code, v]) => (pred(code) ? t + v : t), 0);
  const typeOf = (code: string) => nonprofitLine(code)?.type;

  const grossRevenue = sumWhere((c) => typeOf(c) === "revenue");
  const nettedExpenses = sumWhere((c) => typeOf(c) === "expense" && isNettedLine(c));
  const functionalExpenses = sumWhere((c) => typeOf(c) === "expense" && !isNettedLine(c));
  const beginningNetAssets = sumWhere((c) => typeOf(c) === "equity");

  const ledger: NonprofitLedger = {
    tb,
    mappings,
    lines,
    totals: {
      grossRevenue,
      nettedExpenses,
      functionalExpenses,
      assets: sumWhere((c) => typeOf(c) === "asset"),
      liabilities: sumWhere((c) => typeOf(c) === "liability"),
      beginningNetAssets,
      endingNetAssets: beginningNetAssets + grossRevenue - nettedExpenses - functionalExpenses,
    },
  };
  return { ledger, editable: { ledger: { catalog: NONPROFIT_CATALOG, accounts: tb.accounts, mappings } } };
}

export const lineAmount = (ledger: NonprofitLedger, code: string): Cents => ledger.lines[code] ?? 0;

/** Rows for a "line → amount" table, skipping zero lines. */
export function lineRows(ledger: NonprofitLedger, type: Account["type"], filter: (code: string) => boolean = () => true) {
  return NONPROFIT_CATALOG.lines
    .filter((l) => l.type === type && filter(l.code) && lineAmount(ledger, l.code) !== 0)
    .map((l) => ({ code: l.code, label: l.label, amount: lineAmount(ledger, l.code) }));
}
