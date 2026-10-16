import "server-only";
import { getEngagement } from "@/core/services/engagements";
import { getOrganization } from "@/core/services/organizations";
import { NotFoundError, type Actor } from "@/core/services/context";
import { emptyOverrides, type PriorYear } from "@/core/product";
import { SIGNED } from "@/core/workflow";
import { getProduct } from "@/products";

/** The product's export of the signed work, or undefined when this actor may not have it. */
export async function signedExport(actor: Actor, id: string): Promise<{ body: unknown; name: string } | undefined> {
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? undefined : Promise.reject(err)));
  if (!e || !e.accessible || !e.draft || (actor.role === "client" && !SIGNED.includes(e.status))) return undefined;
  const product = getProduct(e.product);
  if (!product.export) return undefined;
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
  return { body, name: `${e.product}-${e.period}` };
}
