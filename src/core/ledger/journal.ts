import type { Cents } from "../money";

/**
 * Journal entries are the hand-off from an operational product (payroll today; invoicing,
 * bill pay later) to the books. A bookkeeping product imports entries by their stable id,
 * so re-exporting a pay run replaces rather than duplicates. Account codes come from the
 * emitting product's chart (see src/domains/payroll/accounts.ts); the 990 line lets the
 * nonprofit ledger classify each account without a keyword guess.
 */
export interface JournalAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "expense" | "revenue" | "net_assets";
  /** Form 990 line in the nonprofit line catalog, when one applies. */
  line990?: string;
}

export interface JournalLine {
  account: string;
  debit: Cents;
  credit: Cents;
  memo?: string;
  /** Dimension for sub-ledgers (employee, vendor, grant). */
  party?: string;
}

export interface JournalEntry {
  /** Stable across re-exports: `${product}:${engagementId}:${name}`. */
  id: string;
  date: string;
  memo: string;
  source: { product: string; engagementId?: string; period: string };
  lines: JournalLine[];
}

export const isBalanced = (e: JournalEntry) =>
  e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);

export const debit = (account: string, amount: Cents, memo?: string, party?: string): JournalLine => ({ account, debit: amount, credit: 0, memo, party });
export const credit = (account: string, amount: Cents, memo?: string, party?: string): JournalLine => ({ account, debit: 0, credit: amount, memo, party });

/** Drops zero lines so an entry lists only accounts that moved. */
export function entry(id: string, date: string, memo: string, source: JournalEntry["source"], lines: JournalLine[]): JournalEntry {
  const e = { id, date, memo, source, lines: lines.filter((l) => l.debit !== 0 || l.credit !== 0) };
  if (!isBalanced(e)) throw new Error(`Journal entry ${id} does not balance`);
  return e;
}
