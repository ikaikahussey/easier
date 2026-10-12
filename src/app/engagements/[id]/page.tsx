import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { transitionAction, uploadDocumentAction } from "@/app/actions";
import { getEngagement } from "@/core/services/engagements";
import { NotFoundError } from "@/core/services/context";
import { getProduct } from "@/products";
import { Button, Card, Findings, Notice, QuoteBox, Shell, StatusBadge, Worksheet, inputClass } from "@/ui/components";
import { requireActor } from "@/ui/session";

export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  if (actor.role !== "client") redirect(`/review/${id}`);
  const { error } = await searchParams;
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? notFound() : Promise.reject(err)));
  const product = getProduct(e.product);
  const editable = e.status === "awaiting_documents" || e.status === "changes_requested";
  const changeNote = e.events.find((x) => x.type === "status:request_changes")?.payload?.note as string | undefined;

  return (
    <Shell actor={actor}>
      <p className="text-sm text-muted">
        {e.orgName} · {e.productLine}
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">
          {e.productName} · {e.period}
        </h1>
        <StatusBadge status={e.status} label={e.statusLabel} />
      </div>
      <Notice error={error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {e.status === "changes_requested" && changeNote && (
            <Card title="Your reviewer asked for changes">
              <p className="text-sm">{changeNote}</p>
            </Card>
          )}

          {editable && (
            <Card title="Documents">
              {product.documents.map((kind) => {
                const latest = e.documents.find((d) => d.kind === kind.kind);
                return (
                  <form key={kind.kind} action={uploadDocumentAction} className="mb-4 space-y-2">
                    <input type="hidden" name="engagementId" value={e.id} />
                    <input type="hidden" name="kind" value={kind.kind} />
                    <p className="text-sm font-medium">
                      {kind.label} {kind.required && <span className="text-danger">*</span>}
                    </p>
                    <p className="text-xs text-muted">{kind.help}</p>
                    {latest && (
                      <p className="text-xs">
                        Uploaded: {latest.filename} ({Math.ceil(latest.size / 1024)} KB)
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <input type="file" name="file" accept={kind.accept} required className={`${inputClass} max-w-sm`} />
                      <Button type="submit" variant="quiet">
                        Upload
                      </Button>
                    </div>
                  </form>
                );
              })}
              <form action={transitionAction} className="border-t border-line pt-4">
                <input type="hidden" name="engagementId" value={e.id} />
                <input type="hidden" name="action" value="submit" />
                <Button type="submit" disabled={!product.documents.every((k) => !k.required || e.documents.some((d) => d.kind === k.kind))}>
                  Submit for preparation
                </Button>
                <p className="mt-2 text-xs text-muted">
                  Your draft is prepared immediately and routed to a licensed reviewer.
                </p>
              </form>
            </Card>
          )}

          {e.draft && (
            <>
              <Card title="Checks on your draft" aside={<span className="text-xs text-muted">Version {e.draft.version}</span>}>
                <Findings findings={e.draft.snapshot.findings} />
              </Card>
              <Worksheet sections={e.draft.snapshot.sections} />
            </>
          )}
        </div>

        <aside>
          <Card title="Price">
            <QuoteBox quote={e.quote} />
          </Card>
          {e.dueDate && (
            <Card title="Deadline">
              <p className="text-sm">Due {e.dueDate}</p>
              {e.extendedDueDate && <p className="text-sm text-muted">Extended: {e.extendedDueDate}</p>}
            </Card>
          )}
          {(e.status === "approved" || e.status === "delivered") && (
            <Card title="Your return">
              <Link href={`/engagements/${e.id}/package`} className="text-sm">
                Open the signed review package
              </Link>
            </Card>
          )}
          <Card title="Activity">
            <ul className="space-y-1 text-xs text-muted">
              {e.events.map((ev, i) => (
                <li key={i}>
                  {ev.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {ev.type.replace(/[_:]/g, " ")}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}
