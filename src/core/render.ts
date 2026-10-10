import { formatUsd, type Cents } from "./money";
import type { Cell, ReviewSection } from "./product";

/** Small builders so products describe worksheets declaratively. */

export const fields = (
  id: string,
  title: string,
  items: [label: string, value: string | number | boolean | undefined, ref?: string][],
  note?: string,
): ReviewSection => ({
  id,
  title,
  note,
  kind: "fields",
  fields: items.map(([label, value, ref]) => ({
    label,
    value: typeof value === "boolean" ? (value ? "Yes" : "No") : value === undefined ? "—" : String(value),
    ref,
  })),
});

export const table = (
  id: string,
  title: string,
  columns: [key: string, label: string, numeric?: boolean][],
  rows: Record<string, Cell>[],
  opts: { footer?: Record<string, Cell>; note?: string } = {},
): ReviewSection => ({
  id,
  title,
  note: opts.note,
  kind: "table",
  columns: columns.map(([key, label, numeric]) => ({ key, label, numeric })),
  rows,
  footer: opts.footer,
});

/** A two-column "line / amount" table with a total row. */
export const amountTable = (
  id: string,
  title: string,
  rows: { code: string; label: string; amount: Cents }[],
  totalLabel: string,
  note?: string,
): ReviewSection =>
  table(
    id,
    title,
    [
      ["code", "Line"],
      ["label", "Description"],
      ["amount", "Amount", true],
    ],
    rows.map((r) => ({ code: r.code, label: r.label, amount: formatUsd(r.amount) })),
    { footer: { code: "", label: totalLabel, amount: formatUsd(rows.reduce((t, r) => t + r.amount, 0)) }, note },
  );
