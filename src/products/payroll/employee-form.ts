import type { FormSpec } from "@/core/fields";
import { objectToFormValues } from "@/core/fields";
import type { EmployeeProfile } from "@/domains/payroll/types";

/**
 * The employee record as a form. One spec drives the add/edit page, validation, and the
 * conversion to and from the sealed EmployeeProfile. Money is entered in dollars.
 */
export const EMPLOYEE_FORM: FormSpec = [
  {
    title: "Employee",
    fields: [
      { name: "firstName", type: "text", label: "First name", required: true, maxLength: 80 },
      { name: "lastName", type: "text", label: "Last name", required: true, maxLength: 80 },
      { name: "email", type: "email", label: "Email" },
      { name: "hireDate", type: "date", label: "Hire date" },
      { name: "officer", type: "checkbox", label: "Officer, director, trustee, or key employee (reported separately on Form 990)" },
    ],
  },
  {
    title: "Pay",
    fields: [
      {
        name: "payType",
        type: "select",
        label: "Pay type",
        required: true,
        options: [
          { value: "hourly", label: "Hourly" },
          { value: "salary", label: "Salary" },
        ],
      },
      { name: "rate", type: "money", label: "Hourly rate, or annual salary ($)", required: true, min: 0.01 },
      {
        name: "paymentMethod",
        type: "select",
        label: "Paid by",
        required: true,
        options: [
          { value: "check", label: "Check" },
          { value: "direct_deposit", label: "Direct deposit" },
        ],
      },
      { name: "routing", type: "text", label: "Bank routing number (direct deposit)", maxLength: 9 },
      { name: "account", type: "text", label: "Bank account number (direct deposit)", maxLength: 17 },
      {
        name: "accountType",
        type: "select",
        label: "Account type",
        options: [
          { value: "checking", label: "Checking" },
          { value: "savings", label: "Savings" },
        ],
      },
    ],
  },
  {
    title: "Federal withholding (Form W-4)",
    fields: [
      {
        name: "fedStatus",
        type: "select",
        label: "Step 1(c) filing status",
        required: true,
        options: [
          { value: "single", label: "Single or married filing separately" },
          { value: "married", label: "Married filing jointly or qualifying surviving spouse" },
          { value: "head", label: "Head of household" },
        ],
      },
      { name: "fedStep2", type: "checkbox", label: "Step 2(c) box checked (two jobs)" },
      { name: "fedDependents", type: "money", label: "Step 3: dependents and other credits ($ per year)" },
      { name: "fedOtherIncome", type: "money", label: "Step 4(a): other income ($ per year)" },
      { name: "fedDeductions", type: "money", label: "Step 4(b): deductions ($ per year)" },
      { name: "fedExtra", type: "money", label: "Step 4(c): extra withholding ($ per paycheck)" },
      { name: "fedExempt", type: "checkbox", label: "Claims exempt from federal withholding" },
    ],
  },
  {
    title: "Hawaii withholding (Form HW-4)",
    fields: [
      {
        name: "hiStatus",
        type: "select",
        label: "Marital status",
        required: true,
        options: [
          { value: "single", label: "Single (including head of household)" },
          { value: "married", label: "Married" },
        ],
      },
      { name: "hiAllowances", type: "number", label: "Allowances claimed", min: 0, max: 99 },
      { name: "hiExtra", type: "money", label: "Additional withholding ($ per paycheck)" },
      { name: "hiExempt", type: "checkbox", label: "Claims exempt from Hawaii withholding" },
    ],
  },
  {
    title: "Before Easier Payroll",
    help: "If this employee was paid earlier this year through another system, enter those wages so wage bases and year-to-date totals carry over.",
    collapsible: true,
    fields: [
      { name: "priorYear", type: "number", label: "Year", min: 2000, max: 2100 },
      { name: "priorGross", type: "money", label: "Gross wages paid this year before Easier Payroll ($)" },
    ],
  },
];

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  email?: string;
  hireDate?: string;
  officer: boolean;
  payType: "hourly" | "salary";
  rate: number;
  paymentMethod: "check" | "direct_deposit";
  routing?: string;
  account?: string;
  accountType?: "checking" | "savings";
  fedStatus: "single" | "married" | "head";
  fedStep2: boolean;
  fedDependents?: number;
  fedOtherIncome?: number;
  fedDeductions?: number;
  fedExtra?: number;
  fedExempt: boolean;
  hiStatus: "single" | "married";
  hiAllowances?: number;
  hiExtra?: number;
  hiExempt: boolean;
  priorYear?: number;
  priorGross?: number;
}

const cents = (d: number | undefined) => Math.round((d ?? 0) * 100);

export function profileFromForm(v: EmployeeFormValues): EmployeeProfile {
  const dd = v.paymentMethod === "direct_deposit";
  return {
    firstName: v.firstName,
    lastName: v.lastName,
    email: v.email,
    hireDate: v.hireDate,
    officer: v.officer,
    payType: v.payType,
    rate: cents(v.rate),
    federal: {
      filingStatus: v.fedStatus,
      step2: v.fedStep2,
      dependents: cents(v.fedDependents),
      otherIncome: cents(v.fedOtherIncome),
      deductions: cents(v.fedDeductions),
      extra: cents(v.fedExtra),
      exempt: v.fedExempt,
    },
    hawaii: { filingStatus: v.hiStatus, allowances: Math.round(v.hiAllowances ?? 0), extra: cents(v.hiExtra), exempt: v.hiExempt },
    payment: {
      method: v.paymentMethod,
      routing: dd ? v.routing?.replace(/\D/g, "") || undefined : undefined,
      account: dd ? v.account?.trim() || undefined : undefined,
      accountType: dd ? v.accountType : undefined,
    },
    priorWages: v.priorYear && v.priorGross ? { year: Math.round(v.priorYear), gross: cents(v.priorGross) } : undefined,
  };
}

const dollars = (c: number | undefined) => (c ? c / 100 : undefined);

/** Saved profile → form field values, for the edit page. */
export function formValuesFromProfile(p: EmployeeProfile): Record<string, string> {
  const v: EmployeeFormValues = {
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    hireDate: p.hireDate,
    officer: p.officer,
    payType: p.payType,
    rate: p.rate / 100,
    paymentMethod: p.payment.method,
    routing: p.payment.routing,
    account: p.payment.account,
    accountType: p.payment.accountType,
    fedStatus: p.federal.filingStatus,
    fedStep2: p.federal.step2,
    fedDependents: dollars(p.federal.dependents),
    fedOtherIncome: dollars(p.federal.otherIncome),
    fedDeductions: dollars(p.federal.deductions),
    fedExtra: dollars(p.federal.extra),
    fedExempt: p.federal.exempt,
    hiStatus: p.hawaii.filingStatus,
    hiAllowances: p.hawaii.allowances || undefined,
    hiExtra: dollars(p.hawaii.extra),
    hiExempt: p.hawaii.exempt,
    priorYear: p.priorWages?.year,
    priorGross: dollars(p.priorWages?.gross),
  };
  return objectToFormValues(EMPLOYEE_FORM.flatMap((s) => s.fields), v as unknown as Record<string, unknown>);
}
