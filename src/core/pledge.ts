import type { Cents } from "./money";

/**
 * The Labor Pledge. For every engagement, easier.company estimates how many hours a human
 * professional would have spent doing the work the AI did, values those hours at a
 * living wage, and voluntarily contributes the Social Security payroll tax on that value
 * toward worker retirement:
 *
 *   contribution = estimated human hours × living wage × 12.4%
 *
 * The contribution is paid out of easier.company's fee, never added to it.
 */
const envCents = (v: string | undefined, fallback: Cents): Cents => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export const LABOR_PLEDGE = {
  /** Combined OASDI rate: 6.2% employer + 6.2% employee. */
  rate: 0.124,
  rateBasis: "the combined Social Security (OASDI) payroll tax rate",
  /** Hourly living wage in cents. Override with LIVING_WAGE_HOURLY_CENTS. */
  hourlyWage: envCents(process.env.LIVING_WAGE_HOURLY_CENTS, 23_08),
  wageBasis:
    "the national average living wage for one working adult (unweighted average of the 50 states and D.C., MIT Living Wage Calculator, 2025)",
  wageSource: "https://livingwage.mit.edu/",
  /** Set before launch: the fund that receives contributions. */
  recipient: process.env.PLEDGE_RECIPIENT || "a worker retirement fund",
} as const;

/** One unit of work a human professional would otherwise have done. */
export interface LaborTask {
  label: string;
  hours: number;
}

export interface PledgeTerms {
  tasks: LaborTask[];
  hours: number;
  hourlyWage: Cents;
  /** hours × hourly wage */
  laborValue: Cents;
  contribution: Cents;
}

const roundHours = (h: number) => Math.round(h * 100) / 100;

/** Builds a task whose time is a fixed setup plus a per-item rate (e.g. 3 minutes per account). */
export const laborTask = (label: string, base: number, perItem = 0, items = 0): LaborTask => ({
  label,
  hours: roundHours(base + perItem * Math.max(0, items)),
});

export function pledgeFor(tasks: LaborTask[], hourlyWage: Cents = LABOR_PLEDGE.hourlyWage): PledgeTerms {
  const kept = tasks.filter((t) => t.hours > 0).map((t) => ({ ...t, hours: roundHours(t.hours) }));
  const hours = roundHours(kept.reduce((s, t) => s + t.hours, 0));
  const laborValue = Math.round(hours * hourlyWage);
  return { tasks: kept, hours, hourlyWage, laborValue, contribution: Math.round(laborValue * LABOR_PLEDGE.rate) };
}
