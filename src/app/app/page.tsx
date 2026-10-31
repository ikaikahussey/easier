import Link from "next/link";
import { redirect } from "next/navigation";
import { createOrganizationAction } from "@/app/actions";
import { listEngagements } from "@/core/services/engagements";
import { listOrganizations } from "@/core/services/organizations";
import { formatUsd } from "@/core/money";
import { PRODUCTS } from "@/products";
import { Button, buttonClass, Card, Notice, Shell, StatusBadge, inputClass } from "@/ui/components";
import { requireActor } from "@/ui/session";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string; verified?: string; verification_sent?: string }>;
}) {
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { error, welcome, verified, verification_sent } = await searchParams;
  const success = welcome
    ? "Your account is ready. Add your organization below to get started."
    : verified
      ? "Email confirmed."
      : verification_sent
        ? "Confirmation link sent. It expires in 15 minutes."
        : undefined;
  const [orgs, engagements] = await Promise.all([listOrganizations(actor), listEngagements(actor)]);

  return (
    <Shell actor={actor}>
      <Notice error={error} success={success} />
      <h1 className="mb-6 text-3xl font-semibold">Your organizations</h1>

      {orgs.map((org) => (
        <Card
          key={org.id}
          title={org.name}
          aside={<span className="text-sm text-muted">{org.ein ? `EIN ${org.ein}` : "No EIN on file"}</span>}
        >
          <ul className="divide-y divide-line">
            {engagements
              .filter((e) => e.orgId === org.id)
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <Link href={`/engagements/${e.id}`} className="font-bold">
                    {e.productName} · {e.period}
                  </Link>
                  <span className="flex items-center gap-4 text-sm text-muted">
                    {e.dueDate && <span>Due {e.extendedDueDate ? `${e.dueDate} (ext. ${e.extendedDueDate})` : e.dueDate}</span>}
                    <span className="tabular-nums">{formatUsd(e.quote.total)}</span>
                    <StatusBadge status={e.status} label={e.statusLabel} />
                  </span>
                </li>
              ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {PRODUCTS.map((p) => (
              <Link
                key={p.slug}
                href={`/app/orgs/${org.id}/new?product=${p.slug}`}
                className={buttonClass("quiet")}
              >
                Start {p.name}
              </Link>
            ))}
          </div>
        </Card>
      ))}

      <Card title={orgs.length ? "Add another organization" : "Add your organization"}>
        <form action={createOrganizationAction} className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Legal name *</span>
            <input name="name" required className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">EIN</span>
            <input name="ein" placeholder="12-3456789" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Website</span>
            <input name="website" type="url" placeholder="https://" className={inputClass} />
          </label>
          <div className="sm:col-span-3">
            <Button type="submit">Add organization</Button>
            <p className="mt-2 text-xs text-muted">With an EIN, prior-year figures are pulled from public IRS filings.</p>
          </div>
        </form>
      </Card>
    </Shell>
  );
}
