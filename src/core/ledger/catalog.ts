import type { Account, AccountType } from "./trial-balance";
import type { Cents } from "../money";

/**
 * A line catalog is a reporting taxonomy (e.g. Form 990 lines, financial statement
 * lines). Products classify ledger accounts into a catalog, then roll balances up.
 */
export interface CatalogLine {
  code: string;
  label: string;
  type: AccountType;
  /** Lowercase phrases matched against account names. */
  keywords: string[];
  /** Phrases that disqualify a match even if a keyword hits. */
  exclude?: string[];
}

export interface LineCatalog {
  id: string;
  lines: CatalogLine[];
  /** Catch-all line per account type when nothing else matches. */
  fallback: Record<AccountType, string>;
}

export type MappingSource = "override" | "keyword" | "ai" | "fallback";

export interface Mapping {
  accountId: string;
  line: string;
  source: MappingSource;
  /** 0–1. Overrides are 1; fallbacks are 0 and always need human confirmation. */
  confidence: number;
  reason?: string;
}

export type AiClassifier = (accounts: Account[]) => Promise<Omit<Mapping, "source">[]>;

export const lineByCode = (catalog: LineCatalog, code: string) => catalog.lines.find((l) => l.code === code);

export const linesForType = (catalog: LineCatalog, type: AccountType) => catalog.lines.filter((l) => l.type === type);

export function isValidLine(catalog: LineCatalog, account: Account, code: string): boolean {
  return lineByCode(catalog, code)?.type === account.type;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Keywords match at a word start, so "salar" matches "salaries" but "rest" does not match "interest". */
const hits = (name: string, kw: string) => ` ${name}`.includes(` ${norm(kw)}`);

export function classifyByKeywords(account: Account, catalog: LineCatalog): Mapping | undefined {
  const name = norm(account.name);
  let best: { line: CatalogLine; score: number; hit: string } | undefined;
  for (const line of linesForType(catalog, account.type)) {
    if (line.exclude?.some((x) => hits(name, x))) continue;
    for (const kw of line.keywords) {
      if (!hits(name, kw)) continue;
      const score = kw.length;
      if (!best || score > best.score) best = { line, score, hit: kw };
    }
  }
  if (!best) return undefined;
  return {
    accountId: account.id,
    line: best.line.code,
    source: "keyword",
    confidence: 0.9,
    reason: `Account name contains "${best.hit}"`,
  };
}

/**
 * Classification pipeline: reviewer overrides → keyword rules → AI → type fallback.
 * Every account gets exactly one mapping, and every mapping is valid for the account type.
 */
export async function classifyAccounts(
  accounts: Account[],
  catalog: LineCatalog,
  opts: { overrides?: Record<string, string>; ai?: AiClassifier } = {},
): Promise<Mapping[]> {
  const result = new Map<string, Mapping>();
  const pending: Account[] = [];

  for (const a of accounts) {
    const o = opts.overrides?.[a.id];
    if (o && isValidLine(catalog, a, o)) {
      result.set(a.id, { accountId: a.id, line: o, source: "override", confidence: 1, reason: "Set by reviewer" });
      continue;
    }
    const k = classifyByKeywords(a, catalog);
    if (k) result.set(a.id, k);
    else pending.push(a);
  }

  if (pending.length && opts.ai) {
    const suggestions = await opts.ai(pending);
    for (const s of suggestions) {
      const a = pending.find((p) => p.id === s.accountId);
      if (a && !result.has(a.id) && isValidLine(catalog, a, s.line))
        result.set(a.id, { ...s, source: "ai", confidence: Math.max(0, Math.min(1, s.confidence)) });
    }
  }

  for (const a of accounts) {
    if (!result.has(a.id))
      result.set(a.id, {
        accountId: a.id,
        line: catalog.fallback[a.type],
        source: "fallback",
        confidence: 0,
        reason: "No rule or AI match; placed in catch-all line",
      });
  }
  return accounts.map((a) => result.get(a.id)!);
}

export function rollup(accounts: Account[], mappings: Mapping[]): Map<string, Cents> {
  const byId = new Map(mappings.map((m) => [m.accountId, m.line]));
  const totals = new Map<string, Cents>();
  for (const a of accounts) {
    const line = byId.get(a.id);
    if (!line) continue;
    totals.set(line, (totals.get(line) ?? 0) + a.balance);
  }
  return totals;
}
