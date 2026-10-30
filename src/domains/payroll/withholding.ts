import type { Cents } from "@/core/money";
import { bracketTax, type TaxYear } from "./tax-tables";
import type { EmployeeProfile, PayFrequency } from "./types";
import { PAY_FREQUENCIES } from "./types";

const periods = (f: PayFrequency) => PAY_FREQUENCIES[f].periodsPerYear;

/**
 * Federal income tax withholding: Publication 15-T, Worksheet 1A (percentage method for
 * automated payroll systems) for a 2020-or-later Form W-4.
 */
export function federalWithholding(gross: Cents, w4: EmployeeProfile["federal"], frequency: PayFrequency, t: TaxYear): Cents {
  if (w4.exempt) return 0;
  const n = periods(frequency);
  const f = t.federal;
  // Step 1: adjusted annual wage amount.
  const annualWages = gross * n; // 1c
  const otherIncome = w4.otherIncome; // 1d
  const deductions = w4.deductions; // 1f
  const adjustment = w4.step2 ? 0 : f.step2UncheckedAdjustment[w4.filingStatus]; // 1j
  const adjusted = Math.max(0, annualWages + otherIncome - deductions - adjustment); // 1l
  // Step 2: tentative withholding from the applicable schedule.
  const schedule = (w4.step2 ? f.step2Checked : f.standard)[w4.filingStatus];
  const tentativeAnnual = bracketTax(schedule, adjusted); // 2h
  const tentative = Math.round(tentativeAnnual / n); // 2i
  // Step 3: dependents credit per period.
  const credit = Math.round(w4.dependents / n); // 3b
  const afterCredit = Math.max(0, tentative - credit); // 3c
  // Step 4: extra withholding.
  return afterCredit + w4.extra; // 4b
}

/** Hawaii income tax withholding: Booklet A annualized method with the Form HW-4 allowances. */
export function hawaiiWithholding(gross: Cents, hw4: EmployeeProfile["hawaii"], frequency: PayFrequency, t: TaxYear): Cents {
  if (hw4.exempt) return 0;
  const n = periods(frequency);
  const h = t.hawaii;
  const annual = gross * n - h.allowance * Math.max(0, hw4.allowances) - h.lumpSum;
  const annualTax = bracketTax(h.schedule[hw4.filingStatus], annual);
  return Math.max(0, Math.round(annualTax / n)) + hw4.extra;
}

export interface FicaResult {
  socialSecurity: Cents;
  medicare: Cents;
  employerSocialSecurity: Cents;
  employerMedicare: Cents;
}

/** Social Security to the wage base, Medicare on everything, Additional Medicare once year-to-date wages pass the threshold. */
export function fica(gross: Cents, ytdBefore: Cents, t: TaxYear): FicaResult {
  const f = t.federal;
  const ssWages = Math.max(0, Math.min(gross, f.socialSecurityWageBase - ytdBefore));
  const ss = Math.round(ssWages * f.socialSecurityRate);
  const base = Math.round(gross * f.medicareRate);
  const overThreshold = Math.max(0, Math.min(gross, ytdBefore + gross - f.additionalMedicareThreshold));
  const additional = Math.round(overThreshold * f.additionalMedicareRate);
  return { socialSecurity: ss, medicare: base + additional, employerSocialSecurity: ss, employerMedicare: base };
}

/** Employee TDI share: 0.5% of wages, capped per week; the cap scales with the weeks in the pay period. */
export function tdi(gross: Cents, frequency: PayFrequency, t: TaxYear): Cents {
  const weeks = 52 / periods(frequency);
  const cap = Math.round(t.hawaii.tdiWeeklyWageCap * t.hawaii.tdiEmployeeRate * weeks);
  return Math.min(Math.round(gross * t.hawaii.tdiEmployeeRate), cap);
}

/** Tax on the part of this period's wages still under an annual wage base. */
export function wageBaseTax(gross: Cents, ytdBefore: Cents, wageBase: Cents, rate: number): Cents {
  const taxable = Math.max(0, Math.min(gross, wageBase - ytdBefore));
  return Math.round(taxable * rate);
}
