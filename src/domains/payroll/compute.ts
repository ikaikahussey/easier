import { sum, type Cents } from "@/core/money";
import type { TaxYear } from "./tax-tables";
import { PAY_FREQUENCIES, type EmployeePay, type PaySettings, type PayRunTotals, type RosterEmployee, type TimesheetLine } from "./types";
import { federalWithholding, fica, hawaiiWithholding, tdi, wageBaseTax } from "./withholding";

export const OVERTIME_MULTIPLIER = 1.5;
export const OVERTIME_WEEKLY_HOURS = 40;

const dayMs = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoDay(new Date(toDate(iso).getTime() + n * dayMs));

/** The first day of the workweek containing `iso`. */
export function workweekOf(iso: string, workweekStart: number): string {
  const d = toDate(iso);
  const back = (d.getUTCDay() - workweekStart + 7) % 7;
  return addDays(iso, -back);
}

export const roundHours = (h: number) => Math.round(h * 100) / 100;

/** Regular and overtime hours: time over 40 in each workweek is overtime (FLSA and HRS 387-3). */
export function splitHours(lines: TimesheetLine[], workweekStart: number): { regular: number; overtime: number; weeks: Record<string, number> } {
  const weeks: Record<string, number> = {};
  for (const l of lines) {
    const w = workweekOf(l.date, workweekStart);
    weeks[w] = (weeks[w] ?? 0) + l.hours;
  }
  let regular = 0;
  let overtime = 0;
  for (const h of Object.values(weeks)) {
    regular += Math.min(h, OVERTIME_WEEKLY_HOURS);
    overtime += Math.max(0, h - OVERTIME_WEEKLY_HOURS);
  }
  return { regular: roundHours(regular), overtime: roundHours(overtime), weeks };
}

/** One employee's pay for the period. */
export function computePay(emp: RosterEmployee, lines: TimesheetLine[], s: PaySettings, t: TaxYear): EmployeePay {
  const { regular, overtime } = splitHours(lines, s.workweekStart);
  let regularPay: Cents;
  let overtimePay: Cents;
  if (emp.payType === "salary") {
    regularPay = Math.round(emp.rate / PAY_FREQUENCIES[s.frequency].periodsPerYear);
    overtimePay = 0;
  } else {
    regularPay = Math.round(regular * emp.rate);
    overtimePay = Math.round(overtime * emp.rate * OVERTIME_MULTIPLIER);
  }
  const gross = regularPay + overtimePay;
  const fed = federalWithholding(gross, emp.federal, s.frequency, t);
  const hi = hawaiiWithholding(gross, emp.hawaii, s.frequency, t);
  const f = fica(gross, emp.ytdGross, t);
  const tdiShare = s.deductTdi ? tdi(gross, s.frequency, t) : 0;
  const deductions = fed + hi + f.socialSecurity + f.medicare + tdiShare;
  const futa = s.futaExempt ? 0 : wageBaseTax(gross, emp.ytdGross, t.federal.futaWageBase, t.federal.futaRate);
  const ui = wageBaseTax(gross, emp.ytdGross, t.hawaii.uiWageBase, s.uiRate);
  const et = wageBaseTax(gross, emp.ytdGross, t.hawaii.uiWageBase, t.hawaii.etRate);
  const employerTotal = f.employerSocialSecurity + f.employerMedicare + futa + ui + et;
  return {
    employeeId: emp.id,
    name: `${emp.firstName} ${emp.lastName}`.trim(),
    officer: emp.officer,
    payType: emp.payType,
    rate: emp.rate,
    regularHours: regular,
    overtimeHours: overtime,
    regularPay,
    overtimePay,
    gross,
    federalWithholding: fed,
    hawaiiWithholding: hi,
    socialSecurity: f.socialSecurity,
    medicare: f.medicare,
    tdi: tdiShare,
    deductions,
    net: gross - deductions,
    employer: { socialSecurity: f.employerSocialSecurity, medicare: f.employerMedicare, futa, ui, et, total: employerTotal },
    ytdGrossAfter: emp.ytdGross + gross,
    payment: emp.payment,
  };
}

export function totals(pays: EmployeePay[]): PayRunTotals {
  const s = (k: (p: EmployeePay) => Cents) => sum(pays.map(k));
  const gross = s((p) => p.gross);
  const employerTaxes = s((p) => p.employer.total);
  return {
    employees: pays.length,
    hours: roundHours(pays.reduce((h, p) => h + p.regularHours + p.overtimeHours, 0)),
    gross,
    federalWithholding: s((p) => p.federalWithholding),
    hawaiiWithholding: s((p) => p.hawaiiWithholding),
    socialSecurity: s((p) => p.socialSecurity),
    medicare: s((p) => p.medicare),
    tdi: s((p) => p.tdi),
    deductions: s((p) => p.deductions),
    net: s((p) => p.net),
    employerSocialSecurity: s((p) => p.employer.socialSecurity),
    employerMedicare: s((p) => p.employer.medicare),
    futa: s((p) => p.employer.futa),
    ui: s((p) => p.employer.ui),
    et: s((p) => p.employer.et),
    employerTaxes,
    cost: gross + employerTaxes,
  };
}
