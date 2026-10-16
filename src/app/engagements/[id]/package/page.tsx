import Link from "next/link";
import { notFound } from "next/navigation";
import { getEngagement } from "@/core/services/engagements";
import { NotFoundError } from "@/core/services/context";
import { getProduct } from "@/products";
import { Card, FilingSummary, Findings, Shell, Worksheet } from "@/ui/components";
import { SIGNED } from "@/core/workflow";
import { requireActor } from "@/ui/session";

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? notFound() : Promise.reject(err)));
  const ready = SIGNED.includes(e.status);
  if (!e.accessible || !e.draft || (actor.role === "client" && !ready)) notFound();
  const product = getProduct(e.product);
  const approval = e.events.find((x) => x.type === "status:approve");
  const signer = approval?.payload?.signer as { name: string; credential: string } | undefined;

  return (
    <Shell actor={actor}>
      <header className="mb-6 border-b border-line pb-4">
        <p className="text-sm text-muted">{product.line}: review package</p>
        <h1 className="text-3xl font-semibold">
          {e.orgName} — {e.productName}, {e.period}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Draft version {e.draft.version}
          {approval ? ` · Approved ${approval.createdAt.toISOString().slice(0, 10)}` : " · Not yet approved"}
          {signer && ` by ${signer.name}, ${signer.credential}`}
        </p>
      </header>
      {product.export && (
        <p className="mb-6 text-sm">
          Download the return for entry into filing software:{" "}
          <Link href={`/engagements/${e.id}/package/return.csv`} prefetch={false}>
            keying sheet (CSV)
          </Link>{" "}
          ·{" "}
          <Link href={`/engagements/${e.id}/package/return.json`} prefetch={false}>
            line-numbered data (JSON)
          </Link>
        </p>
      )}
      {e.filing && (
        <Card title="E-filing">
          <FilingSummary filing={e.filing} />
        </Card>
      )}
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
