/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-31 and 2026-99-99). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
