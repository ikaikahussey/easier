import { describe, expect, it } from "vitest";
import { buildDraft } from "@/core/draft";
import { formSchema } from "@/core/fields";
import { emptyOverrides } from "@/core/product";
import { isBalanced } from "@/core/ledger/journal";
import { computePay, splitHours, workweekOf } from "@/domains/payroll/compute";
import { parseRoster, parseTimesheet, rosterCsv, timesheetCsv } from "@/domains/payroll/csv";
import { payrollJournal } from "@/domains/payroll/journal";
import { bracketTax, TAX_2026 } from "@/domains/payroll/tax-tables";
import type { PaySettings, RosterEmployee } from "@/domains/payroll/types";
import { federalWithholding, fica, hawaiiWithholding, tdi } from "@/domains/payroll/withholding";
import { payroll, PAYROLL_PRICING, type PayrollData, type PayrollIntake } from "@/products/payroll";

const t = TAX_2026;

const employee = (over: Partial<RosterEmployee> = {}): RosterEmployee => ({
  id: "e1",
  firstName: "Kai",
  lastName: "Lee",
  officer: false,
  payType: "hourly",
  rate: 20_00,
  federal: { filingStatus: "single", step2: false, dependents: 0, otherIncome: 0, deductions: 0, extra: 0, exempt: false },
  hawaii: { filingStatus: "single", allowances: 1, extra: 0, exempt: false },
  payment: { method: "check" },
  ytdGross: 0,
  ...over,
});

const settings: PaySettings = {
  periodStart: "2026-03-02",
  periodEnd: "2026-03-15",
  payDate: "2026-03-20",
  frequency: "biweekly",
  workweekStart: 1,
  uiRate: 0.024,
  futaExempt: true,
  deductTdi: true,
};

describe("tax tables", () => {
  it("federal standard schedules start where the checkbox schedule minus the 1j adjustment would", () => {
    // Standard 0% band = standard deduction − line 1j; checkbox 0% band = half the standard deduction.
    expect(t.federal.standard.married[1]!.from + t.federal.step2UncheckedAdjustment.married).toBe(2 * t.federal.step2Checked.married[1]!.from);
    expect(t.federal.standard.single[1]!.from + t.federal.step2UncheckedAdjustment.single).toBe(2 * t.federal.step2Checked.single[1]!.from);
  });
  it("each schedule's base equals the tax accumulated through the brackets below", () => {
    for (const sched of [...Object.values(t.federal.standard), ...Object.values(t.federal.step2Checked), ...Object.values(t.hawaii.schedule)]) {
      let acc = 0;
      for (let i = 1; i < sched.length; i++) {
        acc += (sched[i]!.from - sched[i - 1]!.from) * sched[i - 1]!.rate;
        expect(Math.abs(sched[i]!.base - acc)).toBeLessThanOrEqual(100); // published bases are rounded to the dollar
      }
    }
  });
  it("computes bracket tax", () => {
    expect(bracketTax(t.federal.standard.single, 43_400_00)).toBe(4_060_00);
    expect(bracketTax(t.federal.standard.single, 0)).toBe(0);
  });
});

describe("withholding", () => {
  it("federal: Pub 15-T Worksheet 1A, single, biweekly $2,000", () => {
    // 52,000 − 8,600 = 43,400 → 1,240 + 12% × 23,500 = 4,060 / 26
    expect(federalWithholding(2_000_00, employee().federal, "biweekly", t)).toBe(156_15);
  });
  it("federal: married, monthly $6,000, two children, $50 extra", () => {
    const w4 = { filingStatus: "married" as const, step2: false, dependents: 4_000_00, otherIncome: 0, deductions: 0, extra: 50_00, exempt: false };
    // 72,000 − 12,900 = 59,100 → 2,480 + 12% × 15,000 = 4,280 / 12 = 356.67; − 333.33 credit; + 50
    expect(federalWithholding(6_000_00, w4, "monthly", t)).toBe(73_34);
  });
  it("federal: step 2 box uses the checkbox schedule with no 1j adjustment", () => {
    const w4 = { ...employee().federal, step2: true };
    // 52,000 → single checkbox: 33,250–60,900: 2,900 + 22% × 18,750 = 7,025 / 26
    expect(federalWithholding(2_000_00, w4, "biweekly", t)).toBe(270_19);
  });
  it("federal: exempt and dependents credit cannot go below zero", () => {
    expect(federalWithholding(2_000_00, { ...employee().federal, exempt: true }, "biweekly", t)).toBe(0);
    expect(federalWithholding(2_000_00, { ...employee().federal, dependents: 50_000_00 }, "biweekly", t)).toBe(0);
  });
  it("hawaii: annualized method, single, one allowance, biweekly $2,000", () => {
    // 52,000 − 1,144 − 4,350 = 46,506 → 1,675 + 7.2% × 10,506 = 2,431.43 / 26
    expect(hawaiiWithholding(2_000_00, employee().hawaii, "biweekly", t)).toBe(93_52);
  });
  it("hawaii: married table and extra withholding", () => {
    const hw4 = { filingStatus: "married" as const, allowances: 2, extra: 10_00, exempt: false };
    // 52,000 − 2,288 − 4,350 = 45,362 → 1,104 + 6.4% × 6,962 = 1,549.57 / 26 = 59.60 + 10
    expect(hawaiiWithholding(2_000_00, hw4, "biweekly", t)).toBe(69_60);
  });
  it("fica: rates, the Social Security wage base, and Additional Medicare", () => {
    expect(fica(2_000_00, 0, t)).toEqual({ socialSecurity: 124_00, medicare: 29_00, employerSocialSecurity: 124_00, employerMedicare: 29_00 });
    expect(fica(2_000_00, 184_000_00, t).socialSecurity).toBe(31_00);
    expect(fica(2_000_00, 199_000_00, t)).toMatchObject({ medicare: 38_00, employerMedicare: 29_00 });
  });
  it("tdi: half a percent of wages, capped per week", () => {
    expect(tdi(2_000_00, "biweekly", t)).toBe(10_00);
    expect(tdi(4_000_00, "biweekly", t)).toBe(15_00);
    expect(tdi(4_000_00, "weekly", t)).toBe(7_50);
  });
});

describe("hours and gross pay", () => {
  it("overtime is hours over 40 in each workweek", () => {
    expect(workweekOf("2026-03-04", 1)).toBe("2026-03-02");
    expect(workweekOf("2026-03-01", 1)).toBe("2026-02-23");
    const lines = ["02", "03", "04", "05", "06"].map((d) => ({ employee: "e1", date: `2026-03-${d}`, hours: 9 }));
    expect(splitHours(lines, 1)).toMatchObject({ regular: 40, overtime: 5 });
    const pay = computePay(employee(), lines, settings, t);
    expect(pay).toMatchObject({ regularPay: 800_00, overtimePay: 150_00, gross: 950_00 });
    expect(pay.net).toBe(pay.gross - pay.federalWithholding - pay.hawaiiWithholding - pay.socialSecurity - pay.medicare - pay.tdi);
  });
  it("salaried employees are paid a fixed share of the annual salary", () => {
    const pay = computePay(employee({ payType: "salary", rate: 52_000_00 }), [], settings, t);
    expect(pay.gross).toBe(2_000_00);
    expect(pay.employer).toMatchObject({ socialSecurity: 124_00, medicare: 29_00, futa: 0, ui: 48_00, et: 20 });
  });
  it("employer taxes stop at the wage bases and FUTA applies when not exempt", () => {
    const pay = computePay(employee({ payType: "salary", rate: 52_000_00, ytdGross: 64_000_00 }), [], { ...settings, futaExempt: false }, t);
    expect(pay.employer.ui).toBe(12_00); // 500 of 2,000 remains under the $64,500 base
    expect(pay.employer.futa).toBe(0); // past $7,000
    const first = computePay(employee({ payType: "salary", rate: 52_000_00 }), [], { ...settings, futaExempt: false }, t);
    expect(first.employer.futa).toBe(12_00);
  });
});

describe("journal", () => {
  it("accrual and payment entries balance and post to the payroll chart", () => {
    const pays = [computePay(employee({ officer: true, payType: "salary", rate: 52_000_00 }), [], settings, t), computePay(employee({ id: "e2", lastName: "Wong" }), [{ employee: "e2", date: "2026-03-03", hours: 10 }], settings, t)];
    const [accrual, payment] = payrollJournal(pays, settings, { engagementId: "eng" });
    expect(accrual!.id).toBe("payroll:eng:accrual");
    expect(isBalanced(accrual!)).toBe(true);
    expect(isBalanced(payment!)).toBe(true);
    expect(accrual!.lines.find((l) => l.account === "6010")?.debit).toBe(2_000_00);
    expect(accrual!.lines.find((l) => l.account === "6020")?.debit).toBe(200_00);
    expect(payment!.lines.filter((l) => l.credit).map((l) => l.party)).toEqual(["e1", "e2"]);
  });
});

describe("csv", () => {
  it("round-trips the roster and timesheet", () => {
    const e = employee({ email: "kai@example.org", payment: { method: "direct_deposit", routing: "121000248", account: "0001", accountType: "checking" }, ytdGross: 1_234_56 });
    expect(parseRoster(rosterCsv([e]))).toEqual([e]);
    const lines = [{ employee: "e1", date: "2026-03-02", hours: 8.5, note: "opening, \"café\"" }];
    expect(parseTimesheet(timesheetCsv(lines))).toEqual(lines);
  });
  it("rejects bad rows with the row number", () => {
    expect(() => parseTimesheet("employee,date,hours\ne1,2026-02-30,8")).toThrow(/Row 2/);
    expect(() => parseRoster("employee_id,first_name,last_name,pay_type,rate\ne1,A,B,daily,20")).toThrow(/pay_type/);
  });
});

describe("pay run product", () => {
  const intake: PayrollIntake = { periodStart: "2026-03-02", payDate: "2026-03-20", frequency: "biweekly", workweekStart: "1", uiRate: 2.4, futaExempt: true, deductTdi: true };
  const roster = [employee(), employee({ id: "e2", firstName: "Ana", lastName: "Reyes", payType: "salary", rate: 52_000_00, officer: true }), employee({ id: "e3", firstName: "Idle", lastName: "Hourly" })];
  const timesheet = (rows: string) => parseTimesheet(`employee,date,hours\n${rows}`);
  const build = (docs: { timesheet: unknown; roster: unknown }, over: Partial<PayrollIntake> = {}, period = "2026-03-15") =>
    buildDraft(payroll, { org: { name: "Org" }, period, intake: { ...intake, ...over }, documents: docs, overrides: emptyOverrides(), prior: [] });

  it("validates the intake form", () => {
    expect(formSchema(payroll.intake).safeParse({ ...intake, workweekStart: "1" }).success).toBe(true);
  });

  it("pays everyone with hours or a salary and passes with no findings", async () => {
    const draft = await build({ timesheet: timesheet("e1,2026-03-03,8\nKai Lee,2026-03-04,8"), roster });
    const data = draft.data as PayrollData;
    expect(data.pays.map((p) => [p.employeeId, p.gross])).toEqual([
      ["e1", 320_00],
      ["e2", 2_000_00],
    ]);
    expect(data.idle).toEqual(["Idle Hourly"]);
    expect(draft.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(draft.findings.map((f) => f.ruleId)).toContain("payroll.no_hours");
    expect(draft.sections.map((s) => s.id)).toEqual(["summary", "register", "employer", "deposits", "journal-accrual", "journal-payment"]);
    expect(payroll.quote(intake, data).total).toBe(PAYROLL_PRICING.run + 2 * PAYROLL_PRICING.perEmployee);
    const out = payroll.export!(data, { org: { name: "Org" }, period: "2026-03-15", intake, documents: {}, overrides: emptyOverrides(), prior: [] }, []) as { payments: { amount: number }[]; journal: unknown[] };
    expect(out.payments).toHaveLength(2);
    expect(out.journal).toHaveLength(2);
  });

  it("blocks unknown employees, hours outside the period, bad dates, and missing deposit details", async () => {
    const dd = employee({ id: "e4", firstName: "No", lastName: "Bank", payment: { method: "direct_deposit" } });
    const draft = await build({ timesheet: timesheet("ghost,2026-03-03,8\ne1,2026-03-01,8\ne4,2026-03-06,8"), roster: [...roster, dd] }, { payDate: "2026-03-10", periodStart: "2026-03-05" });
    const ids = draft.findings.filter((f) => f.severity === "error").map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["payroll.unknown_employee", "payroll.hours_outside_period", "payroll.dates", "payroll.direct_deposit_details"]));
  });

  it("refuses a pay year with no tax tables", async () => {
    const draft = await build({ timesheet: timesheet("e1,2031-03-03,8"), roster }, { periodStart: "2031-03-02", payDate: "2031-03-20" }, "2031-03-15");
    expect(draft.findings.map((f) => f.ruleId)).toContain("payroll.tax_year");
    expect((draft.data as PayrollData).pays).toEqual([]);
  });

  it("warns below minimum wage and on 60-hour weeks", async () => {
    const draft = await build({ timesheet: timesheet("e1,2026-03-02,13\ne1,2026-03-03,13\ne1,2026-03-04,13\ne1,2026-03-05,13\ne1,2026-03-06,13"), roster: [employee({ rate: 15_00 })] });
    expect(draft.findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(["payroll.minimum_wage", "payroll.long_week"]));
  });
});
