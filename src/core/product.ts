import type { FieldSpec, FormSpec } from "./fields";
import type { Cents } from "./money";
import type { Rule, Finding } from "./rules";
import type { AiRun, AiRunner } from "./ai/llm";
import type { Deadline } from "./deadlines";
import type { Account } from "./ledger/trial-balance";
import type { LineCatalog, Mapping } from "./ledger/catalog";
import { pledgeFor, type PledgeTerms } from "./pledge";

/** The client profile shared across every product the organization buys. */
export interface OrgProfile {
  name: string;
  ein?: string;
  city?: string;
  state?: string;
  website?: string;
  /** e.g. "501(c)(3)" */
  subsection?: string;
}

/** Prior-year figures, typically prefilled from public filings. */
export interface PriorYear {
  year: number;
  totalRevenue?: Cents;
  totalExpenses?: Cents;
  totalAssets?: Cents;
}

export interface DocumentKind {
  kind: string;
  label: string;
  help: string;
  accept: string;
  required: boolean;
  /** Parse raw upload text into structured data; throw with a readable message on failure. */
  parse: (text: string) => unknown;
}

/** Reviewer edits. Products read these during build; nothing else mutates a draft. */
export interface Overrides {
  /** accountId → catalog line code */
  mappings: Record<string, string>;
  /** text key → replacement text */
  text: Record<string, string>;
}

export const emptyOverrides = (): Overrides => ({ mappings: {}, text: {} });

export interface BuildInput<I> {
  org: OrgProfile;
  /** Product-specific period key, e.g. fiscal year end "2025-12-31" or month "2026-09". */
  period: string;
  intake: I;
  /** Parsed documents keyed by document kind. */
  documents: Record<string, unknown>;
  overrides: Overrides;
  prior: PriorYear[];
}

export interface EditableText {
  key: string;
  label: string;
  value: string;
  source: "ai" | "override" | "intake" | "fallback";
}

export interface Editable {
  ledger?: { catalog: LineCatalog; accounts: Account[]; mappings: Mapping[] };
  text?: EditableText[];
}

export type Cell = string | number;

export type ReviewSection = { id: string; title: string; note?: string } & (
  | { kind: "fields"; fields: { label: string; value: string; ref?: string }[] }
  | {
      kind: "table";
      columns: { key: string; label: string; numeric?: boolean }[];
      rows: Record<string, Cell>[];
      footer?: Record<string, Cell>;
    }
);

export interface QuoteLine {
  label: string;
  cents: Cents;
  /** Typical traditional-firm fee for this line; drives the Labor Pledge. */
  benchmark?: Cents;
}

export interface Quote {
  tier: string;
  lines: QuoteLine[];
  total: Cents;
  pledge?: PledgeTerms;
}

export interface BuildResult<D> {
  data: D;
  editable: Editable;
}

export interface RuleContext<I, D> {
  input: BuildInput<I>;
  data: D;
}

export interface ProductDefinition<I = any, D = any> {
  slug: string;
  /** Brand line, e.g. "Plainfirm Tax". */
  line: string;
  name: string;
  tagline: string;
  status: "live" | "beta";
  /** Credentials that may sign off, e.g. ["EA", "CPA"]. */
  reviewerCredentials: string[];
  period: FieldSpec & { name: "period" };
  intake: FormSpec;
  documents: DocumentKind[];
  deadline?: (period: string) => Deadline;
  /** Price from intake alone, refined once a draft exists. */
  quote: (intake: I, data?: D) => Quote;
  build: (input: BuildInput<I>, ai: AiRunner) => Promise<BuildResult<D>>;
  rules: Rule<RuleContext<I, D>>[];
  render: (data: D, input: BuildInput<I>) => ReviewSection[];
}

export const defineProduct = <I, D>(p: ProductDefinition<I, D>): ProductDefinition<I, D> => p;

export interface DraftSnapshot<D = unknown> {
  data: D;
  editable: Editable;
  findings: Finding[];
  sections: ReviewSection[];
  ai: AiRun[];
}

export function quote(tier: string, lines: QuoteLine[]): Quote {
  const total = lines.reduce((t, l) => t + l.cents, 0);
  const benchmark = lines.reduce((t, l) => t + (l.benchmark ?? l.cents), 0);
  return { tier, lines, total, pledge: pledgeFor(benchmark, total) };
}
