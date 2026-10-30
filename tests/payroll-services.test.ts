import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/core/db/client";
import { createOrganization } from "@/core/services/organizations";
import { acceptConsents, claim, createEngagement, getEngagement, transition } from "@/core/services/engagements";
import {
  addShift,
  deleteShift,
  fillTimesheetFromSchedule,
  getEmployee,
  listEmployees,
  listShifts,
  listTimeEntries,
  preparePayRun,
  saveEmployee,
  setEmployeeActive,
  setTimeEntry,
  shiftMinutes,
} from "@/core/services/payroll";
import { listReviewers, setCredentialVerified, submitCredential } from "@/core/services/reviewers";
import { ForbiddenError, NotFoundError, ValidationError, type Actor } from "@/core/services/context";
import type { EmployeeProfile } from "@/domains/payroll/types";
import type { PayrollData, PayrollIntake } from "@/products/payroll";
import { freshDb, makeUser } from "./helpers/db";

process.env.PREPARER_OF_RECORD = "Rita Reyes, EA";

let db: Db;
let alice: Actor;
let bob: Actor;
let rita: Actor;
let admin: Actor;
let orgA: string;
let orgB: string;
let kai: string;
let ana: string;

const profile = (over: Partial<EmployeeProfile> = {}): EmployeeProfile => ({
  firstName: "Kai",
  lastName: "Lee",
  officer: false,
  payType: "hourly",
  rate: 20_00,
  federal: { filingStatus: "single", step2: false, dependents: 0, otherIncome: 0, deductions: 0, extra: 0, exempt: false },
  hawaii: { filingStatus: "single", allowances: 1, extra: 0, exempt: false },
  payment: { method: "check" },
  ...over,
});

const intake = (periodStart: string, payDate: string): PayrollIntake => ({
  periodStart,
  payDate,
  frequency: "biweekly",
  workweekStart: "1",
  uiRate: 2.4,
  futaExempt: true,
  deductTdi: true,
});

async function sign(who: Actor, eng: string) {
  const c = (await getEngagement(who, eng)).consents.find((x) => x.id === "engagement_letter")!;
  await acceptConsents(who, eng, { document: "engagement_letter", version: c.version, sha256: c.sha256, signerName: "Leilani Kahale", signerTitle: "Owner" });
}

beforeAll(async () => {
  db = await freshDb();
  alice = await makeUser(db, "alice@a.org");
  bob = await makeUser(db, "bob@b.org");
  rita = await makeUser(db, "rita@easier.company", "reviewer");
  admin = await makeUser(db, "admin@easier.company", "admin");
  orgA = (await createOrganization(alice, { name: "Org A" })).id;
  orgB = (await createOrganization(bob, { name: "Org B" })).id;
  await submitCredential(rita, { name: "Rita Reyes", credentialType: "EA", credentialNumber: "00123456", credentialJurisdiction: "IRS", ptin: "P01234567" });
  const loaded = (await listReviewers(admin)).find((r) => r.id === rita.id)!;
  await setCredentialVerified(admin, rita.id, true, loaded.submittedAt!.toISOString());
});

describe("employees", () => {
  it("creates, reads back, edits, and deactivates", async () => {
    kai = await saveEmployee(alice, orgA, profile());
    ana = await saveEmployee(alice, orgA, profile({ firstName: "Ana", lastName: "Reyes", payType: "salary", rate: 52_000_00, officer: true, payment: { method: "direct_deposit", routing: "121000248", account: "0001", accountType: "checking" } }));
    const list = await listEmployees(alice, orgA);
    expect(list.map((e) => e.profile.firstName)).toEqual(["Kai", "Ana"]);
    expect((await getEmployee(alice, orgA, ana)).profile.payment.account).toBe("0001");

    await saveEmployee(alice, orgA, profile({ rate: 22_00 }), kai);
    expect((await getEmployee(alice, orgA, kai)).profile.rate).toBe(22_00);

    const temp = await saveEmployee(alice, orgA, profile({ firstName: "Temp", lastName: "Worker" }));
    await setEmployeeActive(alice, orgA, temp, false);
    expect((await listEmployees(alice, orgA)).map((e) => e.id)).not.toContain(temp);
    expect((await listEmployees(alice, orgA, { includeInactive: true })).map((e) => e.id)).toContain(temp);
  });
  it("validates direct deposit details and refuses staff", async () => {
    await expect(saveEmployee(alice, orgA, profile({ payment: { method: "direct_deposit", routing: "12", account: "" } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEmployee(rita, orgA, profile())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEmployees(rita, orgA)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("is isolated per organization", async () => {
    await expect(listEmployees(bob, orgA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getEmployee(bob, orgA, kai)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveEmployee(bob, orgA, profile(), kai)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTimeEntry(bob, orgB, { employeeId: kai, date: "2026-03-02", hours: 8 })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listEmployees(bob, orgB)).toEqual([]);
  });
});

describe("schedule and timesheet", () => {
  it("computes shift minutes, including overnight shifts", () => {
    expect(shiftMinutes("09:00", "17:30", 30)).toBe(480);
    expect(shiftMinutes("22:00", "02:00", 0)).toBe(240);
  });
  it("schedules shifts and copies them into the timesheet once", async () => {
    for (const d of ["02", "03", "04", "05", "06"]) await addShift(alice, orgA, { employeeId: kai, date: `2026-03-${d}`, startTime: "08:00", endTime: "17:00", breakMinutes: 30 });
    const extra = await addShift(alice, orgA, { employeeId: kai, date: "2026-03-07", startTime: "08:00", endTime: "12:00", breakMinutes: 0, note: "inventory" });
    await addShift(alice, orgA, { employeeId: kai, date: "2026-03-07", startTime: "14:00", endTime: "18:00", breakMinutes: 0 });
    expect((await listShifts(alice, orgA, "2026-03-02", "2026-03-08")).length).toBe(7);
    await deleteShift(alice, orgA, extra);
    await expect(deleteShift(bob, orgA, extra)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addShift(alice, orgA, { employeeId: kai, date: "2026-03-02", startTime: "8am", endTime: "17:00", breakMinutes: 0 })).rejects.toBeInstanceOf(ValidationError);

    // A manual entry already on the 2nd is kept; the other days come from the schedule.
    await setTimeEntry(alice, orgA, { employeeId: kai, date: "2026-03-02", hours: 10, note: "stayed late" });
    expect(await fillTimesheetFromSchedule(alice, orgA, "2026-03-02", "2026-03-15")).toBe(5);
    expect(await fillTimesheetFromSchedule(alice, orgA, "2026-03-02", "2026-03-15")).toBe(0);
    const entries = await listTimeEntries(alice, orgA, "2026-03-02", "2026-03-15");
    expect(entries.map((e) => [e.date, e.minutes, e.source])).toEqual([
      ["2026-03-02", 600, "manual"],
      ["2026-03-03", 510, "schedule"],
      ["2026-03-04", 510, "schedule"],
      ["2026-03-05", 510, "schedule"],
      ["2026-03-06", 510, "schedule"],
      ["2026-03-07", 240, "schedule"],
    ]);
    // Zero hours removes a day.
    await setTimeEntry(alice, orgA, { employeeId: kai, date: "2026-03-07", hours: 0 });
    expect((await listTimeEntries(alice, orgA, "2026-03-07", "2026-03-07")).length).toBe(0);
  });
});

describe("pay runs", () => {
  let run1: string;
  it("prepares the roster and timesheet from records, drafts, and is approved by a reviewer", async () => {
    run1 = await createEngagement(alice, { orgId: orgA, product: "payroll", period: "2026-03-15", intake: intake("2026-03-02", "2026-03-20") });
    await expect(transition(alice, run1, "submit")).rejects.toThrow(/Accept the engagement letter/);
    await sign(alice, run1);
    await expect(transition(alice, run1, "submit")).rejects.toThrow(/required/);

    const prepared = await preparePayRun(alice, run1);
    expect(prepared).toEqual({ employees: 2, timesheetLines: 5, hours: 44 });
    await expect(preparePayRun(bob, run1)).rejects.toBeInstanceOf(NotFoundError);

    expect(await transition(alice, run1, "submit")).toBe("in_review");
    const e = await getEngagement(alice, run1);
    const data = e.draft!.snapshot.data as PayrollData;
    expect(data.pays.map((p) => [p.employeeId, p.regularHours, p.overtimeHours, p.gross])).toEqual([
      [kai, 40, 4, 1_012_00], // 44 h at $22: 40 × 22 + 4 × 33
      [ana, 0, 0, 2_000_00],
    ]);
    expect(e.draft!.snapshot.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(e.quote.total).toBe(19_00 + 2 * 4_00);

    await claim(rita, run1);
    expect(await transition(rita, run1, "approve")).toBe("approved");
    await expect(preparePayRun(alice, run1)).rejects.toThrow(/already in review/);
  });

  it("carries year-to-date wages into the next run and resets across years", async () => {
    await setTimeEntry(alice, orgA, { employeeId: kai, date: "2026-03-17", hours: 8 });
    const run2 = await createEngagement(alice, { orgId: orgA, product: "payroll", period: "2026-03-29", intake: intake("2026-03-16", "2026-04-03") });
    await sign(alice, run2);
    await preparePayRun(alice, run2);
    await transition(alice, run2, "submit");
    const data = (await getEngagement(alice, run2)).draft!.snapshot.data as PayrollData;
    expect(data.pays.find((p) => p.employeeId === kai)?.ytdGrossAfter).toBe(1_012_00 + 176_00);
    expect(data.pays.find((p) => p.employeeId === ana)?.ytdGrossAfter).toBe(4_000_00);

    // Prior wages from another system count in their year only.
    await saveEmployee(alice, orgA, profile({ firstName: "Ana", lastName: "Reyes", payType: "salary", rate: 52_000_00, officer: true, priorWages: { year: 2025, gross: 10_000_00 } }), ana);
    const run3 = await createEngagement(alice, { orgId: orgA, product: "payroll", period: "2026-04-12", intake: intake("2026-03-30", "2026-04-17") });
    await sign(alice, run3);
    await preparePayRun(alice, run3);
    await transition(alice, run3, "submit");
    const d3 = (await getEngagement(alice, run3)).draft!.snapshot.data as PayrollData;
    // Run 2 was never approved, so only run 1's totals carry; 2025 prior wages do not.
    expect(d3.pays.find((p) => p.employeeId === ana)?.ytdGrossAfter).toBe(4_000_00);
  });

  it("blocks a run whose pay date has no tax tables", async () => {
    const run = await createEngagement(alice, { orgId: orgA, product: "payroll", period: "2031-01-11", intake: intake("2030-12-29", "2031-01-16") });
    await sign(alice, run);
    await preparePayRun(alice, run);
    await transition(alice, run, "submit");
    const e = await getEngagement(alice, run);
    expect(e.errorCount).toBeGreaterThan(0);
    expect(e.draft!.snapshot.findings.map((f) => f.ruleId)).toContain("payroll.tax_year");
  });
});
