import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { allFields, objectToFormValues } from "@/core/fields";
import { getEngagement } from "@/core/services/engagements";
import { NotFoundError } from "@/core/services/context";
import { getProduct } from "@/products";
import { Shell } from "@/ui/components";
import { IntakeForm } from "@/ui/intake-form";
import { requireActor } from "@/ui/session";

export default async function EditIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (actor.role !== "client") redirect(`/review/${id}`);
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? notFound() : Promise.reject(err)));
  if (e.status !== "awaiting_documents" && e.status !== "changes_requested") redirect(`/engagements/${id}`);
  const product = getProduct(e.product);

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        {e.orgName} · <Link href={`/engagements/${e.id}`}>{e.productName} · {e.period}</Link>
      </p>
      <h1 className="mb-6 text-3xl font-semibold">Edit your answers</h1>
      <IntakeForm
        orgId={e.orgId}
        product={product.slug}
        periodLabel={product.period.label}
        form={product.intake}
        engagementId={e.id}
        initial={objectToFormValues(allFields(product.intake), e.intake as Record<string, unknown>)}
      />
    </Shell>
  );
}
