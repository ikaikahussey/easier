import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrganization } from "@/core/services/organizations";
import { Shell } from "@/ui/components";
import { EmployeeForm } from "@/ui/employee-form";
import { requireActor } from "@/ui/session";

export default async function NewEmployee({ params }: { params: Promise<{ orgId: string }> }) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId } = await params;
  const org = await getOrganization(actor, orgId).catch(() => notFound());
  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        <Link href={`/app/orgs/${orgId}/payroll`}>{org.name} · Payroll</Link>
      </p>
      <h1 className="mb-6 text-3xl font-semibold">Add an employee</h1>
      <EmployeeForm orgId={orgId} />
    </Shell>
  );
}
