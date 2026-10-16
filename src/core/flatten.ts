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

const cell = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV with a header row. Cells that a spreadsheet would read as a formula are quoted. */
export function toCsv(rows: FlatRow[]): string {
  return ["field,value", ...rows.map(([f, v]) => `${cell(f)},${cell(v)}`)].join("\r\n") + "\r\n";
}
