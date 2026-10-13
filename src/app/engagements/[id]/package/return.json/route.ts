import { NextResponse } from "next/server";
import { getEngagement } from "@/core/services/engagements";
import { getOrganization } from "@/core/services/organizations";
import { NotFoundError } from "@/core/services/context";
import { emptyOverrides, type PriorYear } from "@/core/product";
import { getProduct } from "@/products";
import { requireActor } from "@/ui/session";

/** The approved return as line-numbered JSON, for entry into filing software. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? undefined : Promise.reject(err)));
  const ready = e?.status === "approved" || e?.status === "delivered";
  if (!e || !e.accessible || !e.draft || (actor.role === "client" && !ready)) return new NextResponse("Not found", { status: 404 });
  const product = getProduct(e.product);
  if (!product.export) return new NextResponse("No export for this product", { status: 404 });
  const org = await getOrganization(actor, e.orgId);
  const periodYear = Number(e.period.slice(0, 4));
  const body = product.export(
    e.draft.snapshot.data,
    {
      org: org.profile,
      period: e.period,
      intake: e.intake,
      documents: {},
      overrides: e.draft.overrides ?? emptyOverrides(),
      prior: (org.publicFilings as PriorYear[]).filter((p) => p.year < periodYear),
    },
    e.draft.snapshot.findings,
  );
  return NextResponse.json(body, {
    headers: { "content-disposition": `attachment; filename="${e.product}-${e.period}.json"` },
  });
}
