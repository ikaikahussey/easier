import { NotFoundError, ForbiddenError } from "@/core/services/context";
import { part120Enabled, rosterCsv } from "@/programs/part-120/service";
import { currentActor } from "@/ui/session";

/** The roster with clearance status, for import into a scheduling system. Same access rules as the desk. */
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = part120Enabled() ? await currentActor() : undefined;
  const { orgId } = await params;
  if (!actor || !/^[0-9a-f-]{36}$/i.test(orgId)) return new Response("Not found", { status: 404 });
  try {
    return new Response(await rosterCsv(actor, orgId), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="roster.csv"', "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
