/**
 * Flattens nested export data into (field, value) rows: the keying sheet a preparer works
 * from when entering a return into filing software, and the starting point for mapping
 * to a vendor's bulk-import template. Arrays become numbered segments; empty values are
 * dropped.
 */
export type FlatRow = [field: string, value: string];

export function flatten(value: unknown, prefix = ""): FlatRow[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => flatten(v, prefix ? `${prefix}.${i + 1}` : String(i + 1)));
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  if (typeof value === "boolean") return [[prefix, value ? "Yes" : "No"]];
  return [[prefix, String(value)]];
}

/** A text cell a spreadsheet would run as a formula gets a leading apostrophe; numbers are left alone. */
const neutralize = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
const cell = (raw: string) => {
  const s = neutralize(raw);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a header row. Text that a spreadsheet would run as a formula is neutralized. */
export function toCsv(rows: FlatRow[]): string {
  return ["field,value", ...rows.map(([f, v]) => `${cell(f)},${cell(v)}`)].join("\r\n") + "\r\n";
}
