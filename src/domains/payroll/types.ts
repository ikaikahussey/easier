import type { Cents } from "@/core/money";
import type { FederalFilingStatus, HawaiiFilingStatus } from "./tax-tables";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PAY_FREQUENCIES: Record<PayFrequency, { label: string; periodsPerYear: number }> = {
  weekly: { label: "Weekly", periodsPerYear: 52 },
  biweekly: { label: "Every two weeks", periodsPerYear: 26 },
  semimonthly: { label: "Twice a month", periodsPerYear: 24 },
  monthly: { label: "Monthly", periodsPerYear: 12 },
};

export type PayType = "hourly" | "salary";
export type PaymentMethod = "direct_deposit" | "check";

/** Everything the platform knows about an employee. Sealed with the organization's key at rest. */
export interface EmployeeProfile {
  firstName: string;
  lastName: string;
  email?: string;
  /** Officers' pay is reported separately (Form 990 Part IX line 5). */
  officer: boolean;
  payType: PayType;
  /** Hourly rate, or annual salary, in cents. */
  rate: Cents;
  hireDate?: string;
  federal: {
    filingStatus: FederalFilingStatus;
    /** Form W-4 Step 2 checkbox (two jobs). */
    step2: boolean;
    /** W-4 Step 3: annual credit for dependents. */
    dependents: Cents;
    /** W-4 Step 4(a): other annual income. */
    otherIncome: Cents;
    /** W-4 Step 4(b): annual deductions beyond the standard deduction. */
    deductions: Cents;
    /** W-4 Step 4(c): extra withholding per pay period. */
    extra: Cents;
    exempt: boolean;
  };
  hawaii: {
    filingStatus: HawaiiFilingStatus;
    /** Form HW-4 allowances. */
    allowances: number;
    /** Form HW-4 additional withholding per pay period. */
    extra: Cents;
    exempt: boolean;
  };
  payment: {
    method: PaymentMethod;
    routing?: string;
    account?: string;
    accountType?: "checking" | "savings";
  };
  /** Wages paid earlier in the year through another system, so wage bases carry over. */
  priorWages?: { year: number; gross: Cents };
}

/** Roster line as the pay run sees it: the profile plus year-to-date wages before this run. */
export interface RosterEmployee extends EmployeeProfile {
  id: string;
  ytdGross: Cents;
}

/** Hours worked on one day, from the built-in timesheet or an uploaded CSV. */
export interface TimesheetLine {
  employee: string;
  date: string;
  hours: number;
  note?: string;
}

export interface PaySettings {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  frequency: PayFrequency;
  /** 0 = Sunday … 6 = Saturday. Overtime is hours over 40 in this workweek. */
  workweekStart: number;
  /** Employer's Hawaii UI contribution rate, as a fraction (new employers: 0.024). */
  uiRate: number;
  /** 501(c)(3) organizations are exempt from FUTA. */
  futaExempt: boolean;
  /** Whether the employee share of TDI is deducted (employers may absorb it). */
  deductTdi: boolean;
}

export interface EmployeePay {
  employeeId: string;
  name: string;
  officer: boolean;
  payType: PayType;
  rate: Cents;
  regularHours: number;
  overtimeHours: number;
  regularPay: Cents;
  overtimePay: Cents;
  gross: Cents;
  federalWithholding: Cents;
  hawaiiWithholding: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  tdi: Cents;
  deductions: Cents;
  net: Cents;
  employer: {
    socialSecurity: Cents;
    medicare: Cents;
    futa: Cents;
    ui: Cents;
    et: Cents;
    total: Cents;
  };
  ytdGrossAfter: Cents;
  payment: EmployeeProfile["payment"];
}

export interface PayRunTotals {
  employees: number;
  hours: number;
  gross: Cents;
  federalWithholding: Cents;
  hawaiiWithholding: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  tdi: Cents;
  deductions: Cents;
  net: Cents;
  employerSocialSecurity: Cents;
  employerMedicare: Cents;
  futa: Cents;
  ui: Cents;
  et: Cents;
  employerTaxes: Cents;
  /** Gross plus employer taxes. */
  cost: Cents;
}
