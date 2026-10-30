import { parseCsv } from "@/core/ledger/csv";
import { parseAmount, type Cents } from "@/core/money";
import { isIsoDate } from "@/core/dates";
import type { RosterEmployee, TimesheetLine } from "./types";

/**
 * The two inputs a pay run reads. Both are CSV so a client can upload them from another
 * system; the platform writes the same files from its own employee records and timesheet.
 */

export const TIMESHEET_COLUMNS = ["employee", "date", "hours", "note"] as const;

const header = (row: string[]) => row.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));

function table(text: string, required: readonly string[]): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The file is empty");
  const cols = header(rows[0]!);
  for (const r of required) if (!cols.includes(r)) throw new Error(`Missing column "${r}" (found: ${cols.join(", ")})`);
  return rows.slice(1).map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}

export function parseTimesheet(text: string): TimesheetLine[] {
  return table(text, ["employee", "date", "hours"]).map((r, i) => {
    const hours = Number(r.hours);
    if (!r.employee) throw new Error(`Row ${i + 2}: employee is blank`);
    if (!isIsoDate(r.date!)) throw new Error(`Row ${i + 2}: date "${r.date}" is not YYYY-MM-DD`);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new Error(`Row ${i + 2}: hours "${r.hours}" must be between 0 and 24`);
    return { employee: r.employee!, date: r.date!, hours: Math.round(hours * 100) / 100, note: r.note || undefined };
  });
}

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (vals: unknown[]) => vals.map(cell).join(",");

export function timesheetCsv(lines: TimesheetLine[]): string {
  return [line([...TIMESHEET_COLUMNS]), ...lines.map((l) => line([l.employee, l.date, l.hours, l.note ?? ""]))].join("\r\n") + "\r\n";
}

export const ROSTER_COLUMNS = [
  "employee_id",
  "first_name",
  "last_name",
  "email",
  "officer",
  "pay_type",
  "rate",
  "hire_date",
  "fed_status",
  "fed_step2",
  "fed_dependents",
  "fed_other_income",
  "fed_deductions",
  "fed_extra",
  "fed_exempt",
  "hi_status",
  "hi_allowances",
  "hi_extra",
  "hi_exempt",
  "pay_method",
  "routing",
  "account",
  "account_type",
  "ytd_gross",
] as const;

const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(v ?? "");
const dollars = (v: string | undefined): Cents => parseAmount(v || "0");
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], what: string, fallback?: T): T => {
  const s = (v ?? "").trim().toLowerCase() as T;
  if (allowed.includes(s)) return s;
  if (!s && fallback !== undefined) return fallback;
  throw new Error(`${what} must be one of ${allowed.join(", ")}`);
};

export function parseRoster(text: string): RosterEmployee[] {
  return table(text, ["employee_id", "first_name", "last_name", "pay_type", "rate"]).map((r, i) => {
    const row = i + 2;
    try {
      const rate = dollars(r.rate);
      if (rate <= 0) throw new Error("rate must be positive");
      return {
        id: r.employee_id!,
        firstName: r.first_name!,
        lastName: r.last_name!,
        email: r.email || undefined,
        officer: yes(r.officer),
        payType: oneOf(r.pay_type, ["hourly", "salary"] as const, "pay_type"),
        rate,
        hireDate: r.hire_date || undefined,
        federal: {
          filingStatus: oneOf(r.fed_status, ["single", "married", "head"] as const, "fed_status", "single"),
          step2: yes(r.fed_step2),
          dependents: dollars(r.fed_dependents),
          otherIncome: dollars(r.fed_other_income),
          deductions: dollars(r.fed_deductions),
          extra: dollars(r.fed_extra),
          exempt: yes(r.fed_exempt),
        },
        hawaii: {
          filingStatus: oneOf(r.hi_status, ["single", "married"] as const, "hi_status", "single"),
          allowances: Math.max(0, Math.round(Number(r.hi_allowances || 0))),
          extra: dollars(r.hi_extra),
          exempt: yes(r.hi_exempt),
        },
        payment: {
          method: oneOf(r.pay_method, ["direct_deposit", "check"] as const, "pay_method", "check"),
          routing: r.routing || undefined,
          account: r.account || undefined,
          accountType: r.account_type ? oneOf(r.account_type, ["checking", "savings"] as const, "account_type") : undefined,
        },
        ytdGross: dollars(r.ytd_gross),
      };
    } catch (err) {
      throw new Error(`Row ${row}: ${(err as Error).message}`);
    }
  });
}

const usd = (c: Cents) => (c / 100).toFixed(2);

export function rosterCsv(employees: RosterEmployee[]): string {
  return (
    [
      line([...ROSTER_COLUMNS]),
      ...employees.map((e) =>
        line([
          e.id,
          e.firstName,
          e.lastName,
          e.email ?? "",
          e.officer ? "yes" : "no",
          e.payType,
          usd(e.rate),
          e.hireDate ?? "",
          e.federal.filingStatus,
          e.federal.step2 ? "yes" : "no",
          usd(e.federal.dependents),
          usd(e.federal.otherIncome),
          usd(e.federal.deductions),
          usd(e.federal.extra),
          e.federal.exempt ? "yes" : "no",
          e.hawaii.filingStatus,
          e.hawaii.allowances,
          usd(e.hawaii.extra),
          e.hawaii.exempt ? "yes" : "no",
          e.payment.method,
          e.payment.routing ?? "",
          e.payment.account ?? "",
          e.payment.accountType ?? "",
          usd(e.ytdGross),
        ]),
      ),
    ].join("\r\n") + "\r\n"
  );
}
