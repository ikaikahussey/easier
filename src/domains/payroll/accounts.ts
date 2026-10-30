import type { JournalAccount } from "@/core/ledger/journal";

/** The payroll chart of accounts: what a pay run posts to, mapped to Form 990 lines for Easier Books. */
export const PAYROLL_ACCOUNTS = {
  cash: { code: "1010", name: "Operating cash", type: "asset", line990: "X.1" },
  wagesPayable: { code: "2100", name: "Wages payable", type: "liability", line990: "X.17" },
  federalTaxesPayable: { code: "2110", name: "Federal payroll taxes payable (Form 941)", type: "liability", line990: "X.17" },
  hawaiiWithholdingPayable: { code: "2120", name: "Hawaii income tax withheld payable (Form HW-14)", type: "liability", line990: "X.17" },
  tdiPayable: { code: "2130", name: "Hawaii TDI employee contributions payable", type: "liability", line990: "X.17" },
  futaPayable: { code: "2140", name: "FUTA payable (Form 940)", type: "liability", line990: "X.17" },
  uiPayable: { code: "2150", name: "Hawaii unemployment insurance payable (Form UC-B6)", type: "liability", line990: "X.17" },
  officerCompensation: { code: "6010", name: "Officer compensation", type: "expense", line990: "IX.5" },
  wages: { code: "6020", name: "Salaries and wages", type: "expense", line990: "IX.7" },
  payrollTaxes: { code: "6030", name: "Employer payroll taxes", type: "expense", line990: "IX.10" },
} as const satisfies Record<string, JournalAccount>;

export const payrollChart = (): JournalAccount[] => Object.values(PAYROLL_ACCOUNTS);
