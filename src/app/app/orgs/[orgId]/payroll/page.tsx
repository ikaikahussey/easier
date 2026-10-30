import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setEmployeeActiveAction } from "@/app/actions";
import { formatUsd, formatUsdCents } from "@/core/money";
import { listEngagements } from "@/core/services/engagements";
import { getOrganization } from "@/core/services/organizations";
import { listEmployees } from "@/core/services/payroll";
import { Button, buttonClass, Card, Notice, Shell, StatusBadge } from "@/ui/components";
import { requireActor } from "@/ui/session";
import { thisWeek } from "@/ui/weeks";

export default async function PayrollHome({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId } = await params;
  const { error, saved } = await searchParams;
  const org = await getOrganization(actor, orgId).catch(() => notFound());
  const [staff, runs] = await Promise.all([listEmployees(actor, orgId, { includeInactive: true }), listEngagements(actor, { orgId })]);
  const payRuns = runs.filter((e) => e.product === "payroll").sort((a, b) => (a.period < b.period ? 1 : -1));
  const week = thisWeek();

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        <Link href="/app">{org.name}</Link> · Easier Payroll
      </p>
      <h1 className="mb-2 text-3xl font-semibold">Payroll</h1>
      <p className="mb-6 max-w-2xl text-muted">
        Keep the schedule and timesheet here, then start a pay run: the platform drafts gross-to-net pay, a reviewer checks it, and
        you get payment instructions, pay stubs, and journal entries for your books.
      </p>
      <Notice error={error} success={saved ? "Employee saved." : undefined} />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link href={`/app/orgs/${orgId}/payroll/schedule?week=${week}`} className={buttonClass("quiet")}>
          Schedule
        </Link>
        <Link href={`/app/orgs/${orgId}/payroll/timesheet?week=${week}`} className={buttonClass("quiet")}>
          Timesheet
        </Link>
        <Link href={`/app/orgs/${orgId}/payroll/employees/new`} className={buttonClass("quiet")}>
          Add employee
        </Link>
        <Link href={`/app/orgs/${orgId}/new?product=payroll`} className={buttonClass("primary")}>
          Start a pay run
        </Link>
      </div>

      <Card title="Employees">
        {staff.length === 0 ? (
          <p className="text-sm">No employees yet. Add one to build the schedule and timesheet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>Name</th>
                  <th>Pay</th>
                  <th>Paid by</th>
                  <th>Withholding</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((e) => {
                  const p = e.profile;
                  return (
                    <tr key={e.id} className={e.active ? "" : "text-muted"}>
                      <td>
                        <Link href={`/app/orgs/${orgId}/payroll/employees/${e.id}`}>
                          {p.firstName} {p.lastName}
                        </Link>
                        {p.officer && <span className="ml-2 text-xs uppercase tracking-wider">officer</span>}
                        {!e.active && <span className="ml-2 text-xs uppercase tracking-wider">inactive</span>}
                      </td>
                      <td className="tabular-nums">{p.payType === "hourly" ? `${formatUsdCents(p.rate)}/h` : `${formatUsd(p.rate)}/yr`}</td>
                      <td>{p.payment.method === "direct_deposit" ? "Direct deposit" : "Check"}</td>
                      <td className="text-xs">
                        W-4 {p.federal.filingStatus}
                        {p.federal.step2 ? ", step 2" : ""}
                        {p.federal.exempt ? ", exempt" : ""} · HW-4 {p.hawaii.filingStatus}, {p.hawaii.allowances} allow.
                        {p.hawaii.exempt ? ", exempt" : ""}
                      </td>
                      <td className="text-right">
                        <form action={setEmployeeActiveAction}>
                          <input type="hidden" name="orgId" value={orgId} />
                          <input type="hidden" name="employeeId" value={e.id} />
                          <input type="hidden" name="active" value={e.active ? "no" : "yes"} />
                          <Button type="submit" variant={e.active ? "danger" : "quiet"} className="text-xs">
                            {e.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Pay runs">
        {payRuns.length === 0 ? (
          <p className="text-sm">No pay runs yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {payRuns.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link href={`/engagements/${e.id}`} className="font-bold">
                  Period ending {e.period}
                </Link>
                <span className="flex items-center gap-4 text-sm text-muted">
                  <span className="tabular-nums">{formatUsd(e.quote.total)}</span>
                  <StatusBadge status={e.status} label={e.statusLabel} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          A pay run is one engagement per pay period. Approved runs carry each employee&apos;s year-to-date wages into the next.
        </p>
      </Card>
    </Shell>
  );
}
