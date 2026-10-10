import type { Cents } from "@/core/money";

export type FormType = "990-N" | "990-EZ" | "990";

/** IRS filing thresholds for tax-exempt organizations other than private foundations. */
export const THRESHOLDS = {
  /** 990-N: gross receipts normally ≤ $50,000. */
  postcardMaxReceipts: 50_000_00,
  /** 990-EZ: gross receipts < $200,000 and total assets < $500,000. */
  ezMaxReceipts: 200_000_00,
  ezMaxAssets: 500_000_00,
} as const;

/**
 * "Normally ≤ $50,000" is a three-year average for organizations more than three
 * years old. Prior-year receipts are averaged in when available.
 */
export function selectFormType(
  grossReceipts: Cents,
  totalAssets: Cents,
  priorReceipts: Cents[] = [],
): { formType: FormType; reason: string; usedAverage: boolean } {
  const window = [grossReceipts, ...priorReceipts.slice(0, 2)];
  const normally = Math.round(window.reduce((t, v) => t + v, 0) / window.length);
  if (normally <= THRESHOLDS.postcardMaxReceipts)
    return {
      formType: "990-N",
      reason: `Gross receipts normally ≤ $50,000 (${window.length}-year average used)`,
      usedAverage: window.length === 3,
    };
  if (grossReceipts < THRESHOLDS.ezMaxReceipts && totalAssets < THRESHOLDS.ezMaxAssets)
    return { formType: "990-EZ", reason: "Gross receipts < $200,000 and total assets < $500,000", usedAverage: false };
  return {
    formType: "990",
    reason:
      grossReceipts >= THRESHOLDS.ezMaxReceipts
        ? "Gross receipts ≥ $200,000"
        : "Total assets ≥ $500,000",
    usedAverage: false,
  };
}
