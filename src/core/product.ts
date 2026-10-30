import type { ConsentId } from "./consents";
import type { FieldSpec, FormSpec } from "./fields";
import type { Cents } from "./money";
import type { Rule, Finding } from "./rules";
import type { AiRun, AiRunner } from "./ai/llm";
import type { Deadline } from "./deadlines";
import type { Account } from "./ledger/trial-balance";
import type { LineCatalog, Mapping } from "./ledger/catalog";
import { pledgeFor, type LaborTask, type PledgeTerms } from "./pledge";

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
  /** The platform can write this document from the organization's own records (see services/generators). Uploading is still allowed. */
  generated?: boolean;
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
  /** Brand line, e.g. "Easier Tax". */
  line: string;
  name: string;
  tagline: string;
  status: "live" | "beta";
  /** Credentials that may sign off, e.g. ["EA", "CPA"]. */
  reviewerCredentials: string[];
  /** Documents the client must accept before the engagement can be submitted. */
  consents: ConsentId[];
  /** True when the finished work is filed with the IRS, which adds filed → accepted/rejected states. */
  filedWithIrs?: boolean;
  period: FieldSpec & { name: "period" };
  intake: FormSpec;
  /** Prefilled answers for a new engagement's intake form, as form values. */
  intakeDefaults?: Record<string, string>;
  documents: DocumentKind[];
  deadline?: (period: string) => Deadline;
  /** Price from intake alone, refined once a draft exists. */
  quote: (intake: I, data?: D) => Omit<Quote, "pledge">;
  /**
   * Hours a human professional would have spent on this engagement, task by task.
   * Drives the Labor Pledge; called with intake alone before a draft exists.
   */
  labor: (intake: I, data?: D) => LaborTask[];
  build: (input: BuildInput<I>, ai: AiRunner) => Promise<BuildResult<D>>;
  rules: Rule<RuleContext<I, D>>[];
  render: (data: D, input: BuildInput<I>) => ReviewSection[];
  /** The finished work as structured data for the client or for filing software. */
  export?: (data: D, input: BuildInput<I>, findings: Finding[]) => unknown;
}

export const defineProduct = <I, D>(p: ProductDefinition<I, D>): ProductDefinition<I, D> => p;

export interface DraftSnapshot<D = unknown> {
  data: D;
  editable: Editable;
  findings: Finding[];
  sections: ReviewSection[];
  ai: AiRun[];
}

export function quote(tier: string, lines: QuoteLine[]): Omit<Quote, "pledge"> {
  return { tier, lines, total: lines.reduce((t, l) => t + l.cents, 0) };
}

/** The price a client sees, with the Labor Pledge contribution computed from the product's labor estimate. */
export function priceEngagement<I, D>(product: ProductDefinition<I, D>, intake: I, data?: D): Quote {
  return { ...product.quote(intake, data), pledge: pledgeFor(product.labor(intake, data)) };
}
