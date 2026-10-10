import { parseCsv } from "./csv";
import { parseAmount, type Cents } from "../money";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  number?: string;
  name: string;
  type: AccountType;
  debit: Cents;
  credit: Cents;
  /** Balance on the account's normal side (debit for assets/expenses, credit otherwise). */
  balance: Cents;
}

export interface TrialBalance {
  accounts: Account[];
  totalDebit: Cents;
  totalCredit: Cents;
  warnings: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  number: ["account number", "account #", "account no", "acct", "acct no", "number", "code", "gl code"],
  name: ["account name", "account", "name", "description"],
  type: ["type", "account type", "category", "class"],
  debit: ["debit", "debits", "dr"],
  credit: ["credit", "credits", "cr"],
  balance: ["balance", "amount", "ending balance", "net"],
};

const TYPE_KEYWORDS: [AccountType, RegExp][] = [
  ["equity", /equity|net asset|fund balance/i],
  ["liability", /liabilit|payable|credit card|loan|deferred|accrued/i],
  ["asset", /asset|bank|cash|receivable|inventory|prepaid|fixed/i],
  ["revenue", /income|revenue|support/i],
  ["expense", /expense|cost of goods|cogs/i],
];

export const normalBalanceIsDebit = (t: AccountType) => t === "asset" || t === "expense";

function normalizeType(raw: string | undefined, number: string | undefined): AccountType | undefined {
  if (raw) {
    const exact = ACCOUNT_TYPES.find((t) => t === raw.trim().toLowerCase());
    if (exact) return exact;
    for (const [t, re] of TYPE_KEYWORDS) if (re.test(raw)) return t;
  }
  const lead = number?.match(/^\d/)?.[0];
  if (lead) return (["asset", "liability", "equity", "revenue"] as const)[Number(lead) - 1] ?? "expense";
  return undefined;
}

function indexHeaders(header: string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[_]+/g, " "));
  const out: Partial<Record<string, number>> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseTrialBalance(csv: string): TrialBalance {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("Trial balance needs a header row and at least one account");
  const cols = indexHeaders(rows[0]!);
  if (cols.name === undefined) throw new Error("Trial balance needs an account name column");
  if (cols.balance === undefined && (cols.debit === undefined || cols.credit === undefined))
    throw new Error("Trial balance needs Debit and Credit columns, or a Balance column");

  const accounts: Account[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const cell = (r: string[], k: keyof typeof HEADER_ALIASES) => {
    const i = cols[k];
    return i === undefined ? undefined : r[i]?.trim();
  };

  for (const [i, r] of rows.slice(1).entries()) {
    let name = cell(r, "name") ?? "";
    if (!name || /^total\b/i.test(name)) continue;
    let number = cell(r, "number") || undefined;
    if (!number) {
      const m = name.match(/^(\d{3,})\s*[-·:]?\s*(.+)$/);
      if (m) [number, name] = [m[1], m[2]!];
    }
    const type = normalizeType(cell(r, "type"), number);
    if (!type) {
      warnings.push(`Row ${i + 2} ("${name}"): account type could not be determined; skipped`);
      continue;
    }
    let debit: Cents, credit: Cents;
    if (cols.debit !== undefined && cols.credit !== undefined) {
      debit = parseAmount(cell(r, "debit"));
      credit = parseAmount(cell(r, "credit"));
    } else {
      // Signed balance column: positive = debit.
      const b = parseAmount(cell(r, "balance"));
      debit = Math.max(b, 0);
      credit = Math.max(-b, 0);
    }
    let id = number ?? slug(name);
    while (seen.has(id)) id += "'";
    seen.add(id);
    const balance = normalBalanceIsDebit(type) ? debit - credit : credit - debit;
    accounts.push({ id, number, name, type, debit, credit, balance });
  }

  return {
    accounts,
    totalDebit: accounts.reduce((t, a) => t + a.debit, 0),
    totalCredit: accounts.reduce((t, a) => t + a.credit, 0),
    warnings,
  };
}
