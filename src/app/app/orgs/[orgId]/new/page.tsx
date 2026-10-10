import { notFound } from "next/navigation";
import { getOrganization } from "@/core/services/organizations";
import { PRODUCTS } from "@/products";
import { Shell } from "@/ui/components";
import { IntakeForm } from "@/ui/intake-form";
import { requireActor } from "@/ui/session";

export default async function NewEngagement({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const actor = await requireActor();
  const { orgId } = await params;
  const { product: slug } = await searchParams;
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) notFound();
  const org = await getOrganization(actor, orgId).catch(() => notFound());

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">{org.name}</p>
      <h1 className="mb-2 text-3xl font-semibold">{product.name}</h1>
      <p className="mb-6 max-w-2xl text-muted">{product.tagline}</p>
      <IntakeForm orgId={org.id} product={product.slug} periodLabel={product.period.label} form={product.intake} />
    </Shell>
  );
}
