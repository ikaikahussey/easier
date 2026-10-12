import Link from "next/link";
import { notFound } from "next/navigation";
import { claimAction, saveReviewAction, transitionAction } from "@/app/actions";
import { linesForType } from "@/core/ledger/catalog";
import { formatUsd } from "@/core/money";
import { getEngagement } from "@/core/services/engagements";
import { NotFoundError } from "@/core/services/context";
import type { Action } from "@/core/workflow";
import { Button, Card, Findings, Notice, QuoteBox, Shell, StatusBadge, Worksheet, inputClass } from "@/ui/components";
import { requireStaff } from "@/ui/session";

const ACTION_LABEL: Record<Action, string> = {
  submit: "Rebuild draft",
  request_changes: "Request changes from client",
  approve: "Approve and sign",
  reopen: "Reopen",
  deliver: "Mark delivered",
};

const SOURCE_LABEL = { override: "Reviewer", keyword: "Rule", ai: "AI", fallback: "Unclassified" } as const;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const { error } = await searchParams;
  const e = await getEngagement(actor, id).catch((err) => (err instanceof NotFoundError ? notFound() : Promise.reject(err)));

  const header = (
    <>
      <p className="text-sm text-muted">
        <Link href="/review" >
          Review queue
        </Link>{" "}
        · {e.productLine}
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">
          {e.orgName} — {e.productName}, {e.period}
        </h1>
        <StatusBadge status={e.status} label={e.statusLabel} />
      </div>
      <Notice error={error} />
    </>
  );

  if (!e.accessible)
    return (
      <Shell actor={actor}>
        {header}
        <Card title="Claim to review">
          <p className="mb-4 text-sm text-muted">
            Client records are sealed until this engagement is assigned to you. Claiming is logged in the client&apos;s audit trail.
          </p>
          <form action={claimAction}>
            <input type="hidden" name="engagementId" value={e.id} />
            <Button type="submit" disabled={!!e.assignedReviewerId}>
              {e.assignedReviewerId ? "Assigned to another reviewer" : "Claim engagement"}
            </Button>
          </form>
        </Card>
      </Shell>
    );

  const snap = e.draft?.snapshot;
  const editing = e.status === "in_review" && snap;
  const flagged = new Set(snap?.findings.filter((f) => f.subject).map((f) => f.subject));
  const ledger = snap?.editable.ledger;

  return (
    <Shell actor={actor}>
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {snap && (
            <Card title="Findings" aside={<span className="text-xs text-muted">Draft v{e.draft!.version}</span>}>
              <Findings findings={snap.findings} />
            </Card>
          )}

          {editing && (
            <form action={saveReviewAction}>
              <input type="hidden" name="engagementId" value={e.id} />
              {ledger && (
                <Card title="Account classification" aside={<span className="text-xs text-muted">Flagged accounts first</span>}>
                  <div className="overflow-x-auto">
                    <table className="listview sunken w-full bg-white text-sm">
                      <thead>
                        <tr className="text-left">
                          <th className="py-2">Account</th>
                          <th className="text-right">Balance</th>
                          <th className="pl-4">Line</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ledger.accounts]
                          .sort((a, b) => Number(flagged.has(b.id)) - Number(flagged.has(a.id)))
                          .map((a) => {
                            const m = ledger.mappings.find((x) => x.accountId === a.id)!;
                            return (
                              <tr key={a.id} className={`border-b border-line/60 ${flagged.has(a.id) ? "bg-amber-50" : ""}`}>
                                <td className="py-1.5">
                                  {a.number && <span className="mr-2 text-muted">{a.number}</span>}
                                  {a.name}
                                </td>
                                <td className="text-right tabular-nums">{formatUsd(a.balance)}</td>
                                <td className="pl-4">
                                  <input type="hidden" name={`orig:map:${a.id}`} value={m.line} />
                                  <input type="hidden" name={`src:map:${a.id}`} value={m.source} />
                                  <select name={`map:${a.id}`} defaultValue={m.line} className={`${inputClass} py-1`}>
                                    {linesForType(ledger.catalog, a.type).map((l) => (
                                      <option key={l.code} value={l.code}>
                                        {l.code} {l.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="pl-2 text-xs text-muted" title={m.reason}>
                                  {SOURCE_LABEL[m.source]}
                                  {m.source === "ai" && ` ${Math.round(m.confidence * 100)}%`}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {snap.editable.text?.length ? (
                <Card title="Narratives">
                  <div className="space-y-4">
                    {snap.editable.text.map((t) => (
                      <label key={t.key} className="block">
                        <span className="mb-1 flex justify-between text-sm font-medium">
                          {t.label}
                          <span className="text-xs font-normal text-muted">{t.source}</span>
                        </span>
                        <input type="hidden" name={`orig:text:${t.key}`} value={t.value} />
                        <input type="hidden" name={`src:text:${t.key}`} value={t.source} />
                        <textarea name={`text:${t.key}`} defaultValue={t.value} rows={3} className={inputClass} />
                      </label>
                    ))}
                  </div>
                </Card>
              ) : null}
              <div className="mb-6">
                <Button type="submit">Save changes and re-run checks</Button>
              </div>
            </form>
          )}

          {snap && <Worksheet sections={snap.sections} />}
        </div>

        <aside>
          <Card title="Decision">
            <div className="space-y-3">
              {e.actions
                .filter((a) => a !== "submit")
                .map((a) => (
                  <form key={a} action={transitionAction} className="space-y-2">
                    <input type="hidden" name="engagementId" value={e.id} />
                    <input type="hidden" name="action" value={a} />
                    <input type="hidden" name="back" value="review" />
                    {a === "request_changes" && (
                      <textarea name="note" required rows={3} placeholder="What does the client need to do?" className={inputClass} />
                    )}
                    <Button
                      type="submit"
                      variant={a === "approve" ? "primary" : a === "request_changes" ? "danger" : "quiet"}
                      disabled={a === "approve" && e.errorCount > 0}
                      className="w-full"
                    >
                      {ACTION_LABEL[a]}
                    </Button>
                    {a === "approve" && e.errorCount > 0 && (
                      <p className="text-xs text-danger">Resolve {e.errorCount} must-fix finding(s) to approve.</p>
                    )}
                  </form>
                ))}
              {(e.status === "approved" || e.status === "delivered") && (
                <Link href={`/engagements/${e.id}/package`} className="block text-sm">
                  Open review package
                </Link>
              )}
            </div>
          </Card>
          <Card title="Fee">
            <QuoteBox quote={e.quote} />
          </Card>
          <Card title="Audit trail">
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
