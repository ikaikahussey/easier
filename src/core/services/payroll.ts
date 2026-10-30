import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { withTenant, type Tx } from "../db/client";
import { employees, engagements, shifts, timeEntries } from "../db/schema";
import { isIsoDate } from "../dates";
import type { OrgVault } from "../crypto";
import { SIGNED, WorkflowError } from "../workflow";
import { rosterCsv, timesheetCsv } from "@/domains/payroll/csv";
import type { EmployeeProfile, RosterEmployee, TimesheetLine } from "@/domains/payroll/types";
import type { PayrollData, PayrollIntake } from "@/products/payroll";
import { ForbiddenError, isStaff, NotFoundError, principal, ValidationError, vaultFor, type Actor } from "./context";
import { assertCanAct, ctx, latestDraft, loadRow, storeDocument } from "./engagements";

/**
 * Easier Payroll's organization-level records: employees, the schedule, and the timesheet.
 * Members only; staff see payroll data through the documents a pay run writes. Profiles
 * (pay, tax elections, bank details) are sealed with the organization's key.
 */

export interface EmployeeView {
  id: string;
  active: boolean;
  profile: EmployeeProfile;
  updatedAt: Date;
}

export interface ShiftView {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  note: string | null;
  minutes: number;
}

export interface TimeEntryView {
  id: string;
  employeeId: string;
  date: string;
  minutes: number;
  note: string | null;
  source: "manual" | "schedule";
}

const profileCtx = (id: string) => `employees:${id}:profile`;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireMember(actor: Actor) {
  if (isStaff(actor)) throw new ForbiddenError("Payroll records belong to the client organization");
}

function assertDate(d: string, what: string) {
  if (!isIsoDate(d)) throw new ValidationError([`${what}: enter a date as YYYY-MM-DD`]);
}

/** Minutes in a shift; one ending before it starts runs past midnight. */
export function shiftMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let span = m(endTime) - m(startTime);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - breakMinutes);
}

const shiftView = (s: typeof shifts.$inferSelect): ShiftView => ({
  id: s.id,
  employeeId: s.employeeId,
  date: s.date,
  startTime: s.startTime,
  endTime: s.endTime,
  breakMinutes: s.breakMinutes,
  note: s.note,
  minutes: shiftMinutes(s.startTime, s.endTime, s.breakMinutes),
});

// ── Employees ────────────────────────────────────────────────────────────────

async function loadEmployees(tx: Tx, vault: OrgVault, orgId: string, includeInactive: boolean): Promise<EmployeeView[]> {
  const rows = await tx
    .select()
    .from(employees)
    .where(includeInactive ? eq(employees.orgId, orgId) : and(eq(employees.orgId, orgId), eq(employees.active, true)))
    .orderBy(asc(employees.createdAt));
  return rows
    .map((r) => ({ id: r.id, active: r.active, profile: vault.open<EmployeeProfile>(r.profileEnc, profileCtx(r.id)), updatedAt: r.updatedAt }))
    .sort((a, b) => `${a.profile.lastName} ${a.profile.firstName}`.localeCompare(`${b.profile.lastName} ${b.profile.firstName}`));
}

export async function listEmployees(actor: Actor, orgId: string, opts: { includeInactive?: boolean } = {}): Promise<EmployeeView[]> {
  requireMember(actor);
  return withTenant(principal(actor), async (tx) => loadEmployees(tx, await vaultFor(tx, orgId), orgId, !!opts.includeInactive));
}

export async function getEmployee(actor: Actor, orgId: string, id: string): Promise<EmployeeView> {
  requireMember(actor);
  return withTenant(principal(actor), async (tx) => {
    const vault = await vaultFor(tx, orgId);
    const [r] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.orgId, orgId)));
    if (!r) throw new NotFoundError("Employee not found");
    return { id: r.id, active: r.active, profile: vault.open<EmployeeProfile>(r.profileEnc, profileCtx(r.id)), updatedAt: r.updatedAt };
  });
}

function checkProfile(p: EmployeeProfile) {
  const issues: string[] = [];
  if (p.payment.method === "direct_deposit") {
    if (!/^\d{9}$/.test(p.payment.routing ?? "")) issues.push("Routing number must have 9 digits");
    if (!p.payment.account) issues.push("Account number is required for direct deposit");
    if (!p.payment.accountType) issues.push("Choose checking or savings");
  }
  if (p.hireDate && !isIsoDate(p.hireDate)) issues.push("Hire date: enter a date as YYYY-MM-DD");
  if (issues.length) throw new ValidationError(issues);
}

/** Create or update an employee. The whole profile is replaced; the form always posts every field. */
export async function saveEmployee(actor: Actor, orgId: string, profile: EmployeeProfile, id?: string): Promise<string> {
  requireMember(actor);
  checkProfile(profile);
  return withTenant(principal(actor), async (tx) => {
    const vault = await vaultFor(tx, orgId);
    if (id) {
      const updated = await tx
        .update(employees)
        .set({ profileEnc: vault.seal(profile, profileCtx(id)), updatedAt: new Date() })
        .where(and(eq(employees.id, id), eq(employees.orgId, orgId)))
        .returning({ id: employees.id });
      if (!updated.length) throw new NotFoundError("Employee not found");
      return id;
    }
    const newId = crypto.randomUUID();
    await tx.insert(employees).values({ id: newId, orgId, profileEnc: vault.seal(profile, profileCtx(newId)) });
    return newId;
  });
}

/** Deactivated employees keep their history and drop off the schedule, timesheet, and roster. */
export async function setEmployeeActive(actor: Actor, orgId: string, id: string, active: boolean): Promise<void> {
  requireMember(actor);
  await withTenant(principal(actor), async (tx) => {
    const updated = await tx
      .update(employees)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(employees.id, id), eq(employees.orgId, orgId)))
      .returning({ id: employees.id });
    if (!updated.length) throw new NotFoundError("Employee not found");
  });
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export async function listShifts(actor: Actor, orgId: string, from: string, to: string): Promise<ShiftView[]> {
  requireMember(actor);
  return withTenant(principal(actor), async (tx) => {
    const rows = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.orgId, orgId), gte(shifts.date, from), lte(shifts.date, to)))
      .orderBy(asc(shifts.date), asc(shifts.startTime));
    return rows.map(shiftView);
  });
}

export async function addShift(
  actor: Actor,
  orgId: string,
  input: { employeeId: string; date: string; startTime: string; endTime: string; breakMinutes: number; note?: string },
): Promise<string> {
  requireMember(actor);
  const issues: string[] = [];
  if (!isIsoDate(input.date)) issues.push("Date: enter a date as YYYY-MM-DD");
  if (!TIME.test(input.startTime) || !TIME.test(input.endTime)) issues.push("Enter times as HH:MM");
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 480) issues.push("Break must be 0 to 480 minutes");
  if (issues.length) throw new ValidationError(issues);
  return withTenant(principal(actor), async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.orgId, orgId), eq(employees.active, true)));
    if (!emp) throw new NotFoundError("Employee not found");
    const id = crypto.randomUUID();
    await tx.insert(shifts).values({ id, orgId, employeeId: input.employeeId, date: input.date, startTime: input.startTime, endTime: input.endTime, breakMinutes: input.breakMinutes, note: input.note?.trim().slice(0, 200) || null });
    return id;
  });
}

export async function deleteShift(actor: Actor, orgId: string, id: string): Promise<void> {
  requireMember(actor);
  await withTenant(principal(actor), async (tx) => {
    const gone = await tx.delete(shifts).where(and(eq(shifts.id, id), eq(shifts.orgId, orgId))).returning({ id: shifts.id });
    if (!gone.length) throw new NotFoundError("Shift not found");
  });
}

// ── Timesheet ────────────────────────────────────────────────────────────────

export async function listTimeEntries(actor: Actor, orgId: string, from: string, to: string): Promise<TimeEntryView[]> {
  requireMember(actor);
  return withTenant(principal(actor), async (tx) => {
    const rows = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), gte(timeEntries.date, from), lte(timeEntries.date, to)))
      .orderBy(asc(timeEntries.date));
    return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, date: r.date, minutes: r.minutes, note: r.note, source: r.source }));
  });
}

/** Set one employee's hours for a day. Zero hours removes the entry. */
export async function setTimeEntry(actor: Actor, orgId: string, input: { employeeId: string; date: string; hours: number; note?: string }): Promise<void> {
  requireMember(actor);
  assertDate(input.date, "Date");
  if (!Number.isFinite(input.hours) || input.hours < 0 || input.hours > 24) throw new ValidationError(["Hours must be between 0 and 24"]);
  const minutes = Math.round(input.hours * 60);
  await withTenant(principal(actor), async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.orgId, orgId)));
    if (!emp) throw new NotFoundError("Employee not found");
    const where = and(eq(timeEntries.employeeId, input.employeeId), eq(timeEntries.date, input.date));
    if (minutes === 0) {
      await tx.delete(timeEntries).where(where);
      return;
    }
    const note = input.note?.trim().slice(0, 200) || null;
    const updated = await tx.update(timeEntries).set({ minutes, note, source: "manual", updatedAt: new Date() }).where(where).returning({ id: timeEntries.id });
    if (!updated.length) await tx.insert(timeEntries).values({ orgId, employeeId: input.employeeId, date: input.date, minutes, note });
  });
}

/** Copy scheduled shifts into the timesheet for days that have no entry yet. Returns the number of days filled. */
export async function fillTimesheetFromSchedule(actor: Actor, orgId: string, from: string, to: string): Promise<number> {
  requireMember(actor);
  assertDate(from, "From");
  assertDate(to, "To");
  return withTenant(principal(actor), async (tx) => {
    const planned = await tx.select().from(shifts).where(and(eq(shifts.orgId, orgId), gte(shifts.date, from), lte(shifts.date, to)));
    const existing = await tx
      .select({ employeeId: timeEntries.employeeId, date: timeEntries.date })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), gte(timeEntries.date, from), lte(timeEntries.date, to)));
    const have = new Set(existing.map((e) => `${e.employeeId}|${e.date}`));
    const byDay = new Map<string, number>();
    for (const s of planned) {
      const k = `${s.employeeId}|${s.date}`;
      if (have.has(k)) continue;
      byDay.set(k, (byDay.get(k) ?? 0) + shiftMinutes(s.startTime, s.endTime, s.breakMinutes));
    }
    let n = 0;
    for (const [k, minutes] of byDay) {
      if (minutes <= 0) continue;
      const [employeeId, date] = k.split("|") as [string, string];
      await tx.insert(timeEntries).values({ orgId, employeeId, date, minutes, source: "schedule" });
      n++;
    }
    return n;
  });
}

// ── Pay runs ─────────────────────────────────────────────────────────────────

/**
 * Year-to-date gross per employee before this run: the highest running total any signed
 * pay run in the same year recorded, plus wages the employee brought in from before.
 */
async function ytdBefore(tx: Tx, vault: OrgVault, orgId: string, year: number, excluding: string): Promise<Map<string, number>> {
  const ytd = new Map<string, number>();
  const prior = await tx
    .select({ id: engagements.id, intakeEnc: engagements.intakeEnc })
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), eq(engagements.product, "payroll"), inArray(engagements.status, SIGNED)))
    .orderBy(desc(engagements.period));
  for (const p of prior) {
    if (p.id === excluding) continue;
    const intake = vault.open<PayrollIntake>(p.intakeEnc, ctx.intake(p.id));
    if (Number(intake.payDate.slice(0, 4)) !== year) continue;
    const draft = await latestDraft(tx, vault, p.id);
    for (const pay of (draft?.snapshot.data as PayrollData | undefined)?.pays ?? [])
      ytd.set(pay.employeeId, Math.max(ytd.get(pay.employeeId) ?? 0, pay.ytdGrossAfter));
  }
  return ytd;
}

export interface PreparedPayRun {
  employees: number;
  timesheetLines: number;
  hours: number;
}

/**
 * Write the roster and timesheet documents for a pay run from the organization's records.
 * The client can repeat this until the run is submitted; each call adds a newer version.
 */
export async function preparePayRun(actor: Actor, engagementId: string): Promise<PreparedPayRun> {
  requireMember(actor);
  return withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (e.product !== "payroll") throw new ValidationError(["Not a pay run"]);
    if (!["awaiting_documents", "changes_requested"].includes(e.status)) throw new WorkflowError("This pay run is already in review");
    const vault = await vaultFor(tx, e.orgId);
    const intake = vault.open<PayrollIntake>(e.intakeEnc, ctx.intake(e.id));
    const year = Number(intake.payDate.slice(0, 4));

    const staff = await loadEmployees(tx, vault, e.orgId, false);
    if (!staff.length) throw new ValidationError(["Add at least one employee before preparing a pay run"]);
    const ytd = await ytdBefore(tx, vault, e.orgId, year, e.id);
    const roster: RosterEmployee[] = staff.map((s) => {
      const prior = s.profile.priorWages?.year === year ? s.profile.priorWages.gross : 0;
      return { ...s.profile, id: s.id, ytdGross: Math.max(ytd.get(s.id) ?? 0, prior) };
    });

    const entries = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, e.orgId), gte(timeEntries.date, intake.periodStart), lte(timeEntries.date, e.period)))
      .orderBy(asc(timeEntries.date));
    const active = new Set(staff.map((s) => s.id));
    const lines: TimesheetLine[] = entries
      .filter((t) => active.has(t.employeeId))
      .map((t) => ({ employee: t.employeeId, date: t.date, hours: Math.round((t.minutes / 60) * 100) / 100, note: t.note ?? undefined }));

    await storeDocument(tx, vault, e, actor, { kind: "roster", filename: `roster-${e.period}.csv`, text: rosterCsv(roster) }, "document_generated");
    await storeDocument(tx, vault, e, actor, { kind: "timesheet", filename: `timesheet-${intake.periodStart}-${e.period}.csv`, text: timesheetCsv(lines) }, "document_generated");
    return { employees: roster.length, timesheetLines: lines.length, hours: Math.round(lines.reduce((h, l) => h + l.hours, 0) * 100) / 100 };
  });
}

/** Document generators by product, for the engagement page's "prepare" button. */
export const GENERATORS: Record<string, (actor: Actor, engagementId: string) => Promise<PreparedPayRun>> = { payroll: preparePayRun };
