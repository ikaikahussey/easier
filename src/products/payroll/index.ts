import { isIsoDate } from "@/core/dates";
import { formatUsd, formatUsdCents, sum, type Cents } from "@/core/money";
import { laborTask, type LaborTask } from "@/core/pledge";
import { defineProduct, quote, type RuleContext } from "@/core/product";
import { fields, table } from "@/core/render";
import type { Rule } from "@/core/rules";
import type { JournalEntry } from "@/core/ledger/journal";
import { payrollChart } from "@/domains/payroll/accounts";
import { addDays, computePay, splitHours, totals, workweekOf } from "@/domains/payroll/compute";
import { parseRoster, parseTimesheet } from "@/domains/payroll/csv";
import { payrollJournal } from "@/domains/payroll/journal";
import { taxYearFor, TAX_YEARS } from "@/domains/payroll/tax-tables";
import { PAY_FREQUENCIES, type EmployeePay, type PayFrequency, type PayRunTotals, type PaySettings, type RosterEmployee, type TimesheetLine } from "@/domains/payroll/types";

/**
 * Easier Payroll: hours in, paychecks out. Each pay run is an engagement whose period is
 * the last day of the pay period. The timesheet and roster arrive as documents, written by
 * the platform from the built-in schedule and timesheet or uploaded as CSV, so the run is
 * reproducible from what the reviewer saw. Output: a pay register, payment instructions,
 * pay stubs, and journal entries for the books.
 */
export interface PayrollIntake {
  periodStart: string;
  payDate: string;
  frequency: PayFrequency;
  workweekStart: string;
  uiRate: number;
  futaExempt: boolean;
  deductTdi: boolean;
  notes?: string;
}

export interface PayrollData {
  settings: PaySettings;
  taxYear?: number;
  pays: EmployeePay[];
  totals: PayRunTotals;
  /** Timesheet employees with no roster match. */
  unmatched: string[];
  /** Hourly employees on the roster with no hours this period; they are not paid. */
  idle: string[];
  /** Timesheet lines dated outside the pay period. */
  outsidePeriod: TimesheetLine[];
  /** Workweek totals per employee, for the overtime check. */
  weeks: Record<string, Record<string, number>>;
  journal: JournalEntry[];
}

type Ctx = RuleContext<PayrollIntake, PayrollData>;

/** Flat per run plus per employee paid. */
export const PAYROLL_PRICING = { run: 19_00, perEmployee: 4_00 };
export const TYPICAL_PAYROLL_EMPLOYEES = 5;

/** Hours a payroll clerk would spend on one run. Working estimates; refine with time studies. */
export function payrollLabor(employees: number): LaborTask[] {
  return [
    laborTask(`Collect and check ${employees} timesheets (10 min each)`, 0, 1 / 6, employees),
    laborTask(`Compute gross pay, withholding, and deductions (12 min each)`, 0, 0.2, employees),
    laborTask(`Prepare pay stubs and payments (6 min each)`, 0, 0.1, employees),
    laborTask("Tax deposit worksheet and journal entry", 0.5),
  ];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const payrollIntakeDefaults: Record<string, string> = { frequency: "biweekly", workweekStart: "1", uiRate: "2.4", deductTdi: "yes" };

function settingsFrom(intake: PayrollIntake, periodEnd: string): PaySettings {
  return {
    periodStart: intake.periodStart,
    periodEnd,
    payDate: intake.payDate,
    frequency: intake.frequency,
    workweekStart: Number(intake.workweekStart),
    uiRate: intake.uiRate / 100,
    futaExempt: intake.futaExempt,
    deductTdi: intake.deductTdi,
  };
}

const key = (e: RosterEmployee) => [e.id, `${e.firstName} ${e.lastName}`.trim().toLowerCase(), e.email?.toLowerCase()].filter(Boolean) as string[];

const rules: Rule<Ctx>[] = [
  {
    id: "payroll.tax_year",
    severity: "error",
    description: "Tax tables exist for the pay date's year",
    check: ({ data }) =>
      data.taxYear ? undefined : `No payroll tax tables for ${data.settings.payDate.slice(0, 4)} (available: ${Object.keys(TAX_YEARS).join(", ")}); add the year's tables before running this payroll`,
  },
  {
    id: "payroll.dates",
    severity: "error",
    description: "The pay period is in order and the pay date is on or after the period end",
    check: ({ data: { settings: s } }) => {
      const out: string[] = [];
      if (!isIsoDate(s.periodStart) || !isIsoDate(s.payDate)) out.push("Enter dates as YYYY-MM-DD");
      else {
        if (s.periodStart > s.periodEnd) out.push(`The period starts (${s.periodStart}) after it ends (${s.periodEnd})`);
        if (s.payDate < s.periodEnd) out.push(`The pay date (${s.payDate}) is before the period end (${s.periodEnd})`);
        const days = Math.round((Date.parse(s.periodEnd) - Date.parse(s.periodStart)) / 86_400_000) + 1;
        const expected: Record<PayFrequency, [number, number]> = { weekly: [7, 7], biweekly: [14, 14], semimonthly: [13, 16], monthly: [28, 31] };
        const [lo, hi] = expected[s.frequency];
        if (days < lo || days > hi) out.push(`A ${PAY_FREQUENCIES[s.frequency].label.toLowerCase()} period covers ${lo === hi ? lo : `${lo} to ${hi}`} days; this one covers ${days}`);
      }
      return out;
    },
  },
  {
    id: "payroll.unknown_employee",
    severity: "error",
    description: "Every timesheet line belongs to someone on the roster",
    check: ({ data }) => data.unmatched.map((n) => ({ message: `"${n}" on the timesheet is not on the roster`, subject: n })),
  },
  {
    id: "payroll.hours_outside_period",
    severity: "error",
    description: "Timesheet hours fall inside the pay period",
    check: ({ data }) => data.outsidePeriod.map((l) => ({ message: `${l.employee}: ${l.hours} h on ${l.date} is outside ${data.settings.periodStart} to ${data.settings.periodEnd}`, subject: l.employee })),
  },
  {
    id: "payroll.negative_net",
    severity: "error",
    description: "Net pay is not negative",
    check: ({ data }) => data.pays.filter((p) => p.net < 0).map((p) => ({ message: `${p.name}: deductions exceed gross pay (net ${formatUsdCents(p.net)}); reduce extra withholding`, subject: p.employeeId })),
  },
  {
    id: "payroll.direct_deposit_details",
    severity: "error",
    description: "Direct deposit employees have a routing number and account number",
    check: ({ data }) =>
      data.pays
        .filter((p) => p.payment.method === "direct_deposit" && (!/^\d{9}$/.test(p.payment.routing ?? "") || !(p.payment.account ?? "").trim()))
        .map((p) => ({ message: `${p.name} is paid by direct deposit but has no valid routing (9 digits) and account number`, subject: p.employeeId })),
  },
  {
    id: "payroll.minimum_wage",
    severity: "warning",
    description: "Hourly rates meet the Hawaii minimum wage",
    check: ({ data }) => {
      const min = data.taxYear ? TAX_YEARS[data.taxYear]!.hawaii.minimumWage : undefined;
      if (!min) return;
      return data.pays
        .filter((p) => p.payType === "hourly" && p.rate < min)
        .map((p) => ({ message: `${p.name} is paid ${formatUsdCents(p.rate)}/h, below the ${formatUsdCents(min)} minimum wage (a tip credit may apply)`, subject: p.employeeId }));
    },
  },
  {
    id: "payroll.long_week",
    severity: "warning",
    description: "No one works more than 60 hours in a workweek",
    check: ({ data }) =>
      Object.entries(data.weeks).flatMap(([emp, weeks]) =>
        Object.entries(weeks)
          .filter(([, h]) => h > 60)
          .map(([week, h]) => ({ message: `${data.pays.find((p) => p.employeeId === emp)?.name ?? emp}: ${h} hours in the week of ${week}; confirm the timesheet`, subject: emp })),
      ),
  },
  {
    id: "payroll.no_hours",
    severity: "warning",
    description: "Hourly employees have hours this period",
    check: ({ data }) => data.idle.map((n) => ({ message: `${n} is hourly and has no hours this period, so is not paid`, subject: n })),
  },
  {
    id: "payroll.split_workweek",
    severity: "info",
    description: "The pay period lines up with whole workweeks",
    check: ({ data: { settings: s } }) => {
      if (s.frequency !== "weekly" && s.frequency !== "biweekly") return;
      const start = workweekOf(s.periodStart, s.workweekStart);
      const end = addDays(workweekOf(s.periodEnd, s.workweekStart), 6);
      return start !== s.periodStart || end !== s.periodEnd
        ? `The period does not start on ${WEEKDAYS[s.workweekStart]}; overtime is figured on the hours inside the period only`
        : undefined;
    },
  },
  {
    id: "payroll.exempt",
    severity: "info",
    description: "Employees claiming exempt from withholding are noted",
    check: ({ data, input }) => {
      const roster = (input.documents.roster as RosterEmployee[] | undefined) ?? [];
      return data.pays
        .filter((p) => {
          const r = roster.find((e) => e.id === p.employeeId);
          return r && (r.federal.exempt || r.hawaii.exempt);
        })
        .map((p) => ({ message: `${p.name} claims exempt from withholding; keep the current W-4/HW-4 on file (exempt status expires each February)`, subject: p.employeeId }));
    },
  },
  {
    id: "payroll.wage_base",
    severity: "info",
    description: "Employees passing the Social Security wage base are noted",
    check: ({ data }) => {
      const base = data.taxYear ? TAX_YEARS[data.taxYear]!.federal.socialSecurityWageBase : Infinity;
      return data.pays.filter((p) => p.ytdGrossAfter > base).map((p) => ({ message: `${p.name} has passed the Social Security wage base (${formatUsd(base)}) this year`, subject: p.employeeId }));
    },
  },
];

const money = (c: Cents) => formatUsdCents(c);

export const payroll = defineProduct<PayrollIntake, PayrollData>({
  slug: "payroll",
  line: "Easier Payroll",
  name: "Pay run",
  tagline: "Timesheets in, paychecks out: gross to net with Hawaii and federal withholding, checked by a person, posted to your books.",
  status: "beta",
  reviewerCredentials: ["CPA", "EA", "Senior accountant", "Payroll specialist"],
  consents: ["engagement_letter"],
  period: { name: "period", type: "date", label: "Last day of the pay period", required: true },
  intakeDefaults: payrollIntakeDefaults,
  intake: [
    {
      title: "Pay period",
      fields: [
        { name: "periodStart", type: "date", label: "First day of the pay period", required: true },
        { name: "payDate", type: "date", label: "Pay date", required: true },
        {
          name: "frequency",
          type: "select",
          label: "Pay frequency",
          required: true,
          options: (Object.keys(PAY_FREQUENCIES) as PayFrequency[]).map((v) => ({ value: v, label: PAY_FREQUENCIES[v].label })),
        },
        {
          name: "workweekStart",
          type: "select",
          label: "Workweek starts on",
          help: "Overtime is paid on hours over 40 in this seven-day week.",
          required: true,
          options: WEEKDAYS.map((d, i) => ({ value: String(i), label: d })),
        },
      ],
    },
    {
      title: "Employer taxes",
      fields: [
        { name: "uiRate", type: "percent", label: "Hawaii unemployment insurance contribution rate (%)", help: "From your DLIR rate notice. New employers: 2.4.", required: true },
        { name: "futaExempt", type: "checkbox", label: "Exempt from federal unemployment tax (501(c)(3) organizations)" },
        { name: "deductTdi", type: "yesno", label: "Deduct the employee share of Temporary Disability Insurance (0.5% of wages)?", required: true },
        { name: "notes", type: "textarea", label: "Anything unusual this pay run?" },
      ],
    },
  ],
  documents: [
    {
      kind: "timesheet",
      label: "Timesheet (CSV)",
      help: "Columns: employee, date, hours, note. Written from your timesheet when you prepare the pay run, or upload one from another system.",
      accept: ".csv,text/csv",
      required: true,
      generated: true,
      parse: parseTimesheet,
    },
    {
      kind: "roster",
      label: "Employee roster (CSV)",
      help: "Pay rates, W-4 and HW-4 elections, payment details, and year-to-date wages. Written from your employee records when you prepare the pay run.",
      accept: ".csv,text/csv",
      required: true,
      generated: true,
      parse: parseRoster,
    },
  ],
  quote: (_intake, data) => {
    const n = data?.pays.length ?? TYPICAL_PAYROLL_EMPLOYEES;
    return quote("Per pay run", [
      { label: "Pay run", cents: PAYROLL_PRICING.run },
      { label: `${n} employee${n === 1 ? "" : "s"} paid`, cents: PAYROLL_PRICING.perEmployee * n },
    ]);
  },
  labor: (_intake, data) => payrollLabor(data?.pays.length ?? TYPICAL_PAYROLL_EMPLOYEES),

  async build(input) {
    const settings = settingsFrom(input.intake, input.period);
    const roster = input.documents.roster as RosterEmployee[];
    const lines = input.documents.timesheet as TimesheetLine[];
    const tax = taxYearFor(settings.payDate);

    const byKey = new Map<string, RosterEmployee>();
    for (const e of roster) for (const k of key(e)) byKey.set(k, e);
    const grouped = new Map<string, TimesheetLine[]>();
    const unmatched = new Set<string>();
    const outsidePeriod: TimesheetLine[] = [];
    for (const l of lines) {
      const e = byKey.get(l.employee) ?? byKey.get(l.employee.toLowerCase());
      if (!e) {
        unmatched.add(l.employee);
        continue;
      }
      if (l.date < settings.periodStart || l.date > settings.periodEnd) {
        outsidePeriod.push(l);
        continue;
      }
      grouped.set(e.id, [...(grouped.get(e.id) ?? []), l]);
    }

    const pays: EmployeePay[] = [];
    const idle: string[] = [];
    const weeks: Record<string, Record<string, number>> = {};
    for (const e of roster) {
      const mine = grouped.get(e.id) ?? [];
      if (e.payType === "hourly" && !mine.length) {
        idle.push(`${e.firstName} ${e.lastName}`.trim());
        continue;
      }
      weeks[e.id] = splitHours(mine, settings.workweekStart).weeks;
      if (tax) pays.push(computePay(e, mine, settings, tax));
    }
    const journal = tax ? payrollJournal(pays, settings, { engagementId: undefined }) : [];
    return {
      data: { settings, taxYear: tax?.year, pays, totals: totals(pays), unmatched: [...unmatched], idle, outsidePeriod, weeks, journal },
      editable: {},
    };
  },
  rules,
  render: ({ settings: s, pays, totals: t, journal }) => [
    fields("summary", "Pay run summary", [
      ["Pay period", `${s.periodStart} to ${s.periodEnd}`],
      ["Pay date", s.payDate],
      ["Frequency", PAY_FREQUENCIES[s.frequency].label],
      ["Employees paid", pays.length],
      ["Hours", t.hours],
      ["Gross pay", money(t.gross)],
      ["Employee taxes withheld", money(t.deductions)],
      ["Net pay", money(t.net)],
      ["Employer taxes", money(t.employerTaxes)],
      ["Total payroll cost", money(t.cost)],
    ]),
    table(
      "register",
      "Pay register",
      [
        ["name", "Employee"],
        ["hours", "Hours", true],
        ["ot", "OT", true],
        ["gross", "Gross", true],
        ["fed", "Federal", true],
        ["hi", "Hawaii", true],
        ["ss", "Soc. Sec.", true],
        ["med", "Medicare", true],
        ["tdi", "TDI", true],
        ["net", "Net", true],
        ["method", "Paid by"],
      ],
      pays.map((p) => ({
        name: p.name,
        hours: p.payType === "salary" ? "salary" : p.regularHours,
        ot: p.overtimeHours || "",
        gross: money(p.gross),
        fed: money(p.federalWithholding),
        hi: money(p.hawaiiWithholding),
        ss: money(p.socialSecurity),
        med: money(p.medicare),
        tdi: money(p.tdi),
        net: money(p.net),
        method: p.payment.method === "direct_deposit" ? "Direct deposit" : "Check",
      })),
      {
        footer: { name: "Total", hours: t.hours, ot: "", gross: money(t.gross), fed: money(t.federalWithholding), hi: money(t.hawaiiWithholding), ss: money(t.socialSecurity), med: money(t.medicare), tdi: money(t.tdi), net: money(t.net), method: "" },
      },
    ),
    table(
      "employer",
      "Employer taxes",
      [
        ["name", "Employee"],
        ["ss", "Soc. Sec.", true],
        ["med", "Medicare", true],
        ["futa", "FUTA", true],
        ["ui", "Hawaii UI", true],
        ["et", "E&T", true],
        ["total", "Total", true],
      ],
      pays.map((p) => ({ name: p.name, ss: money(p.employer.socialSecurity), med: money(p.employer.medicare), futa: money(p.employer.futa), ui: money(p.employer.ui), et: money(p.employer.et), total: money(p.employer.total) })),
      { footer: { name: "Total", ss: money(t.employerSocialSecurity), med: money(t.employerMedicare), futa: money(t.futa), ui: money(t.ui), et: money(t.et), total: money(t.employerTaxes) } },
    ),
    table(
      "deposits",
      "Tax deposits due",
      [
        ["what", "Deposit"],
        ["amount", "Amount", true],
      ],
      [
        { what: "Federal (Form 941): withholding plus both shares of Social Security and Medicare", amount: money(t.federalWithholding + t.socialSecurity + t.medicare + t.employerSocialSecurity + t.employerMedicare) },
        { what: "Hawaii income tax withheld (Form HW-14)", amount: money(t.hawaiiWithholding) },
        { what: "Hawaii unemployment insurance and E&T (Form UC-B6)", amount: money(t.ui + t.et) },
        { what: "FUTA (Form 940)", amount: money(t.futa) },
        { what: "TDI employee contributions (to your TDI plan or carrier)", amount: money(t.tdi) },
      ],
      { note: "Deposit schedules depend on your lookback-period liability; this lists the amounts, not the due dates." },
    ),
    ...journal.map((j) =>
      table(
        `journal-${j.id.split(":").pop()}`,
        `Journal entry: ${j.memo} (${j.date})`,
        [
          ["account", "Account"],
          ["name", "Name"],
          ["debit", "Debit", true],
          ["credit", "Credit", true],
        ],
        j.lines.map((l) => ({ account: l.account, name: payrollChart().find((a) => a.code === l.account)?.name ?? "", debit: l.debit ? money(l.debit) : "", credit: l.credit ? money(l.credit) : "" })),
        { footer: { account: "", name: "", debit: money(sum(j.lines.map((l) => l.debit))), credit: money(sum(j.lines.map((l) => l.credit))) } },
      ),
    ),
  ],
  export: (data) => ({
    product: "payroll",
    payRun: data.settings,
    taxYear: data.taxYear,
    totals: data.totals,
    payments: data.pays.map((p) => ({
      employeeId: p.employeeId,
      name: p.name,
      amount: p.net / 100,
      method: p.payment.method,
      routing: p.payment.routing,
      account: p.payment.account,
      accountType: p.payment.accountType,
    })),
    payStubs: data.pays.map(({ payment: _payment, ...stub }) => ({ ...stub })),
    journal: data.journal,
    chart: payrollChart(),
  }),
});
