import type { Cents } from "./money";

/**
 * The Labor Pledge. On every engagement, Plainfirm voluntarily contributes toward
 * worker retirement an amount equal to Social Security payroll tax on the value of the
 * human labor our AI displaced. Displaced labor value is the traditional-firm benchmark
 * fee minus the Plainfirm fee. The contribution is paid out of our fee, never added to it.
 */
export const LABOR_PLEDGE = {
  /** Combined OASDI rate: 6.2% employer + 6.2% employee. */
  rate: 0.124,
  rateBasis: "the combined Social Security (OASDI) payroll tax rate",
  /** Set before launch: the fund that receives contributions. */
  recipient: process.env.PLEDGE_RECIPIENT || "a worker retirement fund",
} as const;

export interface PledgeTerms {
  /** Typical fee a traditional firm charges for the same deliverable. */
  benchmark: Cents;
  displacedLabor: Cents;
  contribution: Cents;
}

export function pledgeFor(benchmark: Cents, fee: Cents): PledgeTerms {
  const displacedLabor = Math.max(0, benchmark - fee);
  return { benchmark, displacedLabor, contribution: Math.round(displacedLabor * LABOR_PLEDGE.rate) };
}
