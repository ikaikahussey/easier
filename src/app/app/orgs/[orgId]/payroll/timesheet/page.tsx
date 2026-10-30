import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fillTimesheetAction, saveTimesheetAction } from "@/app/actions";
import { getOrganization } from "@/core/services/organizations";
import { listEmployees, listTimeEntries } from "@/core/services/payroll";
import { addDays, OVERTIME_WEEKLY_HOURS } from "@/domains/payroll/compute";
import { Button, buttonClass, Card, Notice, Shell } from "@/ui/components";
import { requireActor } from "@/ui/session";
import { dayName, hoursOf, weekDays, weekFrom } from "@/ui/weeks";

export default async function TimesheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ week?: string; error?: string; saved?: string; filled?: string }>;
}) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId } = await params;
  const { week: raw, error, saved, filled } = await searchParams;
  const week = weekFrom(raw);
  const days = weekDays(week);
  const org = await getOrganization(actor, orgId).catch(() => notFound());
  const [staff, entries] = await Promise.all([listEmployees(actor, orgId), listTimeEntries(actor, orgId, days[0]!, days[6]!)]);
  const nav = (w: string) => `/app/orgs/${orgId}/payroll/timesheet?week=${w}`;
  const cell = (employeeId: string, date: string) => entries.find((t) => t.employeeId === employeeId && t.date === date);
  const success = saved ? "Timesheet saved." : filled !== undefined ? `${filled} day${filled === "1" ? "" : "s"} copied from the schedule.` : undefined;

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        <Link href={`/app/orgs/${orgId}/payroll`}>{org.name} · Payroll</Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Timesheet</h1>
        <span className="text-sm text-muted">
          Week of {week} to {days[6]}
        </span>
        <span className="ml-auto flex gap-2">
          <Link href={nav(addDays(week, -7))} className={buttonClass("quiet")}>
            ← Previous
          </Link>
          <Link href={nav(addDays(week, 7))} className={buttonClass("quiet")}>
            Next →
          </Link>
          <Link href={`/app/orgs/${orgId}/payroll/schedule?week=${week}`} className={buttonClass("quiet")}>
            Schedule
          </Link>
        </span>
      </div>
      <Notice error={error} success={success} />

      <Card
        title="Hours worked"
        aside={
          <form action={fillTimesheetAction} className="inline">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="week" value={week} />
            <input type="hidden" name="from" value={days[0]} />
            <input type="hidden" name="to" value={days[6]} />
            <button type="submit" className="cursor-pointer underline">
              Copy this week&apos;s schedule into empty days
            </button>
          </form>
        }
      >
        {staff.length === 0 ? (
          <p className="text-sm">
            <Link href={`/app/orgs/${orgId}/payroll/employees/new`}>Add an employee</Link> to record hours.
          </p>
        ) : (
          <form action={saveTimesheetAction}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="week" value={week} />
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th>Employee</th>
                    {days.map((d) => (
                      <th key={d}>
                        {dayName(d)} {d.slice(5)}
                      </th>
                    ))}
                    <th className="text-right">Week</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((e) => {
                    const total = hoursOf(entries.filter((t) => t.employeeId === e.id).reduce((m, t) => m + t.minutes, 0));
                    return (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap font-bold">
                          {e.profile.firstName} {e.profile.lastName}
                          {e.profile.payType === "salary" && <span className="ml-1 text-xs font-normal text-muted">(salary)</span>}
                        </td>
                        {days.map((d) => {
                          const t = cell(e.id, d);
                          const v = t ? String(hoursOf(t.minutes)) : "";
                          return (
                            <td key={d}>
                              <input type="hidden" name={`orig:${e.id}:${d}`} value={v} />
                              <input
                                name={`hours:${e.id}:${d}`}
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={24}
                                step={0.25}
                                defaultValue={v}
                                title={t?.source === "schedule" ? "From the schedule" : t?.note ?? undefined}
                                className={`field w-20 text-sm ${t?.source === "schedule" ? "text-accent" : ""}`}
                              />
                            </td>
                          );
                        })}
                        <td className={`text-right tabular-nums ${total > OVERTIME_WEEKLY_HOURS ? "font-bold text-warn" : ""}`}>{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <Button type="submit">Save hours</Button>
              <span className="text-xs text-muted">Hours in decimals (7.5 = 7 h 30 min). Blank clears a day. Over {OVERTIME_WEEKLY_HOURS} hours in the week is overtime.</span>
            </div>
          </form>
        )}
      </Card>
    </Shell>
  );
}
