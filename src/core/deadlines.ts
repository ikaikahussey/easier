/** Date-only helpers in UTC (ISO YYYY-MM-DD strings) for statutory deadlines. */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function parseIsoDate(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** nth weekday (0=Sun) of a month; n = -1 for last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(y, m, 1);
    return utc(y, m, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(y, m + 1, 0);
  return utc(y, m, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

/** Fixed-date holidays move to Friday/Monday when they fall on a weekend. */
function observed(d: Date): Date {
  const day = d.getUTCDay();
  if (day === 6) return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1);
  if (day === 0) return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return d;
}

/** Legal holidays that move IRS deadlines (federal holidays plus D.C. Emancipation Day). */
export function legalHolidays(year: number): Set<string> {
  const days = [
    observed(utc(year, 0, 1)),
    nthWeekday(year, 0, 1, 3), // MLK Day
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    observed(utc(year, 3, 16)), // D.C. Emancipation Day
    nthWeekday(year, 4, 1, -1), // Memorial Day
    observed(utc(year, 5, 19)),
    observed(utc(year, 6, 4)),
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    observed(utc(year, 10, 11)),
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    observed(utc(year, 11, 25)),
  ];
  return new Set(days.map(iso));
}

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6 && !legalHolidays(d.getUTCFullYear()).has(iso(d));
}

/** A deadline falling on a weekend or legal holiday moves to the next business day. */
export function rollForward(d: Date): Date {
  let x = d;
  while (!isBusinessDay(x)) x = utc(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + 1);
  return x;
}

/** The `day` of the Nth month after the month in which `periodEnd` falls. */
export function dayOfMonthAfter(periodEnd: string, months: number, day: number): Date {
  const end = parseIsoDate(periodEnd);
  return utc(end.getUTCFullYear(), end.getUTCMonth() + months, day);
}

export interface Deadline {
  original: string;
  extended?: string;
}

export function deadline(periodEnd: string, rule: { months: number; day: number; extensionMonths?: number }): Deadline {
  const raw = dayOfMonthAfter(periodEnd, rule.months, rule.day);
  const out: Deadline = { original: iso(rollForward(raw)) };
  if (rule.extensionMonths) {
    out.extended = iso(
      rollForward(utc(raw.getUTCFullYear(), raw.getUTCMonth() + rule.extensionMonths, raw.getUTCDate())),
    );
  }
  return out;
}
