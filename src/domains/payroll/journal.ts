import { credit, debit, entry, type JournalEntry } from "@/core/ledger/journal";
import { sum } from "@/core/money";
import { PAYROLL_ACCOUNTS as A } from "./accounts";
import type { EmployeePay, PaySettings } from "./types";
import { totals } from "./compute";

/**
 * Two entries per pay run: the accrual on the last day of the period (expense and
 * liabilities) and the payment on the pay date (wages payable → cash). Tax liabilities
 * stay open until the deposit, which the books record when it clears.
 */
export function payrollJournal(pays: EmployeePay[], s: PaySettings, source: { engagementId?: string }): JournalEntry[] {
  const t = totals(pays);
  const src = { product: "payroll", engagementId: source.engagementId, period: s.periodEnd };
  const id = (name: string) => `payroll:${source.engagementId ?? s.periodEnd}:${name}`;
  const officerGross = sum(pays.filter((p) => p.officer).map((p) => p.gross));
  const staffGross = t.gross - officerGross;
  const memo = `Payroll ${s.periodStart} to ${s.periodEnd}`;

  const accrual = entry(id("accrual"), s.periodEnd, memo, src, [
    debit(A.officerCompensation.code, officerGross, "Gross wages, officers"),
    debit(A.wages.code, staffGross, "Gross wages"),
    debit(A.payrollTaxes.code, t.employerTaxes, "Employer payroll taxes"),
    credit(A.wagesPayable.code, t.net, "Net pay due"),
    credit(A.federalTaxesPayable.code, t.federalWithholding + t.socialSecurity + t.medicare + t.employerSocialSecurity + t.employerMedicare, "Federal withholding and FICA, both shares"),
    credit(A.hawaiiWithholdingPayable.code, t.hawaiiWithholding, "Hawaii income tax withheld"),
    credit(A.tdiPayable.code, t.tdi, "TDI employee share"),
    credit(A.futaPayable.code, t.futa, "FUTA"),
    credit(A.uiPayable.code, t.ui + t.et, "Hawaii UI and E&T"),
  ]);

  const payment = entry(id("payment"), s.payDate, `Pay date ${s.payDate}`, src, [
    debit(A.wagesPayable.code, t.net, "Net pay"),
    ...pays.map((p) => credit(A.cash.code, p.net, `Net pay, ${p.name}`, p.employeeId)),
  ]);

  return [accrual, payment];
}
