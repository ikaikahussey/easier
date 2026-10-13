import type { Cents } from "@/core/money";

export type FormType = "990-N" | "990-EZ" | "990";

/** IRS filing thresholds for tax-exempt organizations other than private foundations. */
export const THRESHOLDS = {
  /** 990-N: gross receipts normally ≤ $50,000. */
  postcardMaxReceipts: 50_000_00,
  /** First tax year: received or pledged ≤ $75,000. */
  firstYearMaxReceipts: 75_000_00,
  /** Second and third tax years: averaged ≤ $60,000 over the first two years. */
  earlyYearsMaxAverage: 60_000_00,
  /** 990-EZ: gross receipts < $200,000 and total assets < $500,000. */
  ezMaxReceipts: 200_000_00,
  ezMaxAssets: 500_000_00,
} as const;

export interface FormSelection {
  formType: FormType;
  reason: string;
  /** The three-year average was available for the "normally" test. */
  usedAverage: boolean;
}

/**
 * "Gross receipts normally ≤ $50,000" depends on the organization's age:
 * in its first tax year, ≤ $75,000 received or pledged; in its second or third,
 * an average of ≤ $60,000 over the first two years; afterwards, a three-year
 * average (this year and the two before) of ≤ $50,000.
 */
export function selectFormType(
  grossReceipts: Cents,
  totalAssets: Cents,
  priorReceipts: Cents[] = [],
  /** Tax years completed before this one, when known (from the year of formation). */
  priorYears?: number,
): FormSelection {
  const avg = (v: Cents[]) => Math.round(v.reduce((t, x) => t + x, 0) / v.length);
  const prior = priorReceipts.slice(0, 2);
  const postcard = (reason: string, usedAverage: boolean): FormSelection => ({ formType: "990-N", reason, usedAverage });

  if (priorYears === 0 && grossReceipts <= THRESHOLDS.firstYearMaxReceipts)
    return postcard("First tax year with gross receipts ≤ $75,000", false);
  if (priorYears !== undefined && priorYears > 0 && priorYears < 3) {
    const firstTwo = [...prior.slice(0, priorYears), grossReceipts].slice(0, 2);
    if (avg(firstTwo) <= THRESHOLDS.earlyYearsMaxAverage)
      return postcard(`Gross receipts averaged ≤ $60,000 over the first two tax years (${firstTwo.length} year(s) available)`, firstTwo.length === 2);
  }
  if (priorYears === undefined || priorYears >= 3) {
    const window = [grossReceipts, ...prior];
    if (avg(window) <= THRESHOLDS.postcardMaxReceipts)
      return postcard(`Gross receipts normally ≤ $50,000 (${window.length}-year average used)`, window.length === 3);
  }
  if (grossReceipts < THRESHOLDS.ezMaxReceipts && totalAssets < THRESHOLDS.ezMaxAssets)
    return { formType: "990-EZ", reason: "Gross receipts < $200,000 and total assets < $500,000", usedAverage: false };
  return {
    formType: "990",
    reason: grossReceipts >= THRESHOLDS.ezMaxReceipts ? "Gross receipts ≥ $200,000" : "Total assets ≥ $500,000",
    usedAverage: false,
  };
}
