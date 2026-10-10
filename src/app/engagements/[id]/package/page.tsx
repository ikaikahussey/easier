import { notFound } from "next/navigation";
import { getEngagement } from "@/core/services/engagements";
import { NotFoundError } from "@/core/services/context";
import { getProduct } from "@/products";
import { Card, Findings, Shell, Worksheet } from "@/ui/components";
import { requireActor } from "@/ui/session";

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? notFound() : Promise.reject(err)));
  const ready = e.status === "approved" || e.status === "delivered";
  if (!e.accessible || !e.draft || (actor.role === "client" && !ready)) notFound();
  const product = getProduct(e.product);
  const approval = e.events.find((x) => x.type === "status:approve");

  return (
    <Shell actor={actor}>
      <header className="mb-6 border-b border-line pb-4">
        <p className="text-xs uppercase tracking-wide text-accent">{product.line} · Review package</p>
        <h1 className="text-3xl font-semibold">
          {e.orgName} — {e.productName}, {e.period}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Draft version {e.draft.version}
          {approval ? ` · Approved ${approval.createdAt.toISOString().slice(0, 10)}` : " · Not yet approved"}
        </p>
      </header>
      <Worksheet sections={e.draft.snapshot.sections} />
      <Card title="Review notes">
        <Findings findings={e.draft.snapshot.findings} />
      </Card>
      <p className="text-xs text-muted">
        This package is the preparer&apos;s worksheet supporting the return. The return is filed electronically after the
        organization&apos;s authorized officer signs Form 8879-TE.
      </p>
    </Shell>
  );
}
