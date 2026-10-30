import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrganization } from "@/core/services/organizations";
import { getEmployee } from "@/core/services/payroll";
import { formValuesFromProfile } from "@/products/payroll/employee-form";
import { Shell } from "@/ui/components";
import { EmployeeForm } from "@/ui/employee-form";
import { requireActor } from "@/ui/session";

export default async function EditEmployee({ params }: { params: Promise<{ orgId: string; employeeId: string }> }) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId, employeeId } = await params;
  const org = await getOrganization(actor, orgId).catch(() => notFound());
  const e = await getEmployee(actor, orgId, employeeId).catch(() => notFound());
  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        <Link href={`/app/orgs/${orgId}/payroll`}>{org.name} · Payroll</Link>
      </p>
      <h1 className="mb-1 text-3xl font-semibold">
        {e.profile.firstName} {e.profile.lastName}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {e.active ? "Active" : "Inactive"} · last saved {e.updatedAt.toISOString().slice(0, 10)}
      </p>
      <EmployeeForm orgId={orgId} employeeId={employeeId} initial={formValuesFromProfile(e.profile)} />
    </Shell>
  );
}
