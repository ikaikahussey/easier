import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { addShiftAction, deleteShiftAction } from "@/app/actions";
import { getOrganization } from "@/core/services/organizations";
import { listEmployees, listShifts } from "@/core/services/payroll";
import { addDays } from "@/domains/payroll/compute";
import { Button, buttonClass, Card, Notice, Shell, inputClass } from "@/ui/components";
import { requireActor } from "@/ui/session";
import { dayName, hoursOf, weekDays, weekFrom } from "@/ui/weeks";

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ week?: string; error?: string }>;
}) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId } = await params;
  const { week: raw, error } = await searchParams;
  const week = weekFrom(raw);
  const days = weekDays(week);
  const org = await getOrganization(actor, orgId).catch(() => notFound());
  const [staff, shifts] = await Promise.all([listEmployees(actor, orgId), listShifts(actor, orgId, days[0]!, days[6]!)]);
  const name = (id: string) => {
    const e = staff.find((s) => s.id === id)?.profile;
    return e ? `${e.firstName} ${e.lastName}` : "—";
  };
  const nav = (w: string) => `/app/orgs/${orgId}/payroll/schedule?week=${w}`;

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        <Link href={`/app/orgs/${orgId}/payroll`}>{org.name} · Payroll</Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Schedule</h1>
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
          <Link href={`/app/orgs/${orgId}/payroll/timesheet?week=${week}`} className={buttonClass("quiet")}>
            Timesheet
          </Link>
        </span>
      </div>
      <Notice error={error} />

      <Card title="Shifts this week">
        {staff.length === 0 ? (
          <p className="text-sm">
            <Link href={`/app/orgs/${orgId}/payroll/employees/new`}>Add an employee</Link> to start scheduling.
          </p>
        ) : (
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
                  <th className="text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((e) => {
                  const mine = shifts.filter((s) => s.employeeId === e.id);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap font-bold">{name(e.id)}</td>
                      {days.map((d) => (
                        <td key={d}>
                          {mine
                            .filter((s) => s.date === d)
                            .map((s) => (
                              <form key={s.id} action={deleteShiftAction} className="mb-1 flex items-center gap-1 whitespace-nowrap">
                                <input type="hidden" name="orgId" value={orgId} />
                                <input type="hidden" name="week" value={week} />
                                <input type="hidden" name="shiftId" value={s.id} />
                                <span title={s.note ?? undefined}>
                                  {s.startTime}–{s.endTime}
                                  {s.breakMinutes ? ` (${s.breakMinutes}m break)` : ""}
                                </span>
                                <button type="submit" className="cursor-pointer text-xs text-danger" aria-label="Remove shift" title="Remove shift">
                                  ✕
                                </button>
                              </form>
                            ))}
                        </td>
                      ))}
                      <td className="text-right tabular-nums">{hoursOf(mine.reduce((m, s) => m + s.minutes, 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {staff.length > 0 && (
        <Card title="Add a shift">
          <form action={addShiftAction} className="grid gap-3 sm:grid-cols-6">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="week" value={week} />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-bold">Employee</span>
              <select name="employeeId" required className={inputClass}>
                {staff.map((e) => (
                  <option key={e.id} value={e.id}>
                    {name(e.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Date</span>
              <select name="date" required className={inputClass}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {dayName(d)} {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Start</span>
              <input name="startTime" type="time" required defaultValue="09:00" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">End</span>
              <input name="endTime" type="time" required defaultValue="17:00" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Break (min)</span>
              <input name="breakMinutes" type="number" min={0} max={480} step={5} defaultValue={30} className={inputClass} />
            </label>
            <label className="block sm:col-span-5">
              <span className="mb-1 block text-sm font-bold">Note</span>
              <input name="note" maxLength={200} className={inputClass} />
            </label>
            <div className="flex items-end">
              <Button type="submit">Add shift</Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-muted">A shift that ends before it starts runs past midnight. Copy the week into the timesheet from the Timesheet page.</p>
        </Card>
      )}
    </Shell>
  );
}
