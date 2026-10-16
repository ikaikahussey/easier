import Link from "next/link";
import { notFound } from "next/navigation";
import { addReviewTimeAction, claimAction, reviewTimerAction, saveReviewAction, transitionAction } from "@/app/actions";
import { linesForType } from "@/core/ledger/catalog";
import { formatUsd } from "@/core/money";
import { getEngagement } from "@/core/services/engagements";
import { getReviewerProfile } from "@/core/services/reviewers";
import { formatDuration } from "@/core/review-time";
import { getProduct } from "@/products";
import { NotFoundError } from "@/core/services/context";
import { SIGNED, type Action } from "@/core/workflow";
import { Button, Card, FilingSummary, Findings, Notice, QuoteBox, Shell, StatusBadge, Worksheet, inputClass } from "@/ui/components";
import { requireStaff } from "@/ui/session";

const ACTION_LABEL: Record<Action, string> = {
  submit: "Rebuild draft",
  request_changes: "Request changes from client",
  approve: "Approve and sign",
  reopen: "Reopen",
  deliver: "Mark delivered",
  record_filing: "Record e-filing",
  record_acceptance: "Record IRS acceptance",
  record_rejection: "Record IRS rejection",
};

const FILING_ACTIONS: Action[] = ["record_filing", "record_acceptance", "record_rejection"];

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

  const profile = await getReviewerProfile(actor);
  const product = getProduct(e.product);
  const maySign = !!profile.verifiedAt && !!profile.credentialType && product.reviewerCredentials.includes(profile.credentialType);
  const today = new Date().toISOString().slice(0, 10);
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
                    <table className="data-table w-full text-sm">
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
              {e.actions.includes("approve") && !maySign && (
                <p className="text-xs text-danger">
                  You cannot sign until an admin verifies your credential ({product.reviewerCredentials.join(" or ")}).{" "}
                  <Link href="/review/profile">Your credential</Link>
                </p>
              )}
              {e.actions
                .filter((a) => a !== "submit" && !FILING_ACTIONS.includes(a))
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
                      disabled={a === "approve" && (e.errorCount > 0 || !maySign)}
                      className="w-full"
                    >
                      {ACTION_LABEL[a]}
                    </Button>
                    {a === "approve" && e.errorCount > 0 && (
                      <p className="text-xs text-danger">Resolve {e.errorCount} must-fix finding(s) to approve.</p>
                    )}
                  </form>
                ))}
              {SIGNED.includes(e.status) && (
                <Link href={`/engagements/${e.id}/package`} className="block text-sm">
                  Open review package
                </Link>
              )}
            </div>
          </Card>
          {(e.filing || e.actions.some((a) => FILING_ACTIONS.includes(a))) && (
            <Card title="E-filing">
              {e.filing && <FilingSummary filing={e.filing} />}
              {e.actions.includes("record_filing") && (
                <form action={transitionAction} className="mt-3 space-y-2">
                  <input type="hidden" name="engagementId" value={e.id} />
                  <input type="hidden" name="action" value="record_filing" />
                  <input type="hidden" name="back" value="review" />
                  <p className="text-xs text-muted">After the officer signs Form 8879-TE and the return is transmitted.</p>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">IRS submission ID</span>
                    <input name="submissionId" required minLength={20} maxLength={20} className={`${inputClass} font-mono`} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Date transmitted</span>
                    <input name="date" type="date" max={today} defaultValue={today} className={inputClass} />
                  </label>
                  <Button type="submit" className="w-full">
                    {ACTION_LABEL.record_filing}
                  </Button>
                </form>
              )}
              {e.actions.includes("record_acceptance") && (
                <form action={transitionAction} className="mt-3 space-y-2">
                  <input type="hidden" name="engagementId" value={e.id} />
                  <input type="hidden" name="action" value="record_acceptance" />
                  <input type="hidden" name="back" value="review" />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Acknowledgement date</span>
                    <input name="date" type="date" max={today} defaultValue={today} className={inputClass} />
                  </label>
                  <Button type="submit" className="w-full">
                    {ACTION_LABEL.record_acceptance}
                  </Button>
                </form>
              )}
              {e.actions.includes("record_rejection") && (
                <form action={transitionAction} className="mt-3 space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="engagementId" value={e.id} />
                  <input type="hidden" name="action" value="record_rejection" />
                  <input type="hidden" name="back" value="review" />
                  <textarea name="note" required rows={2} placeholder="Rejection codes and what must change" className={inputClass} />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Rejection date</span>
                    <input name="date" type="date" max={today} defaultValue={today} className={inputClass} />
                  </label>
                  <Button type="submit" variant="danger" className="w-full">
                    {ACTION_LABEL.record_rejection}
                  </Button>
                </form>
              )}
            </Card>
          )}
          <Card title="Review time" aside={e.reviewTimerRunning ? <span className="text-xs font-bold text-accent">Timer running</span> : undefined}>
            <p className="text-2xl font-bold tabular-nums">{formatDuration(e.reviewSeconds)}</p>
            <p className="mb-3 text-xs text-muted">Pilot target: a full Form 990 under 6 hours. Includes time keyed in outside the platform.</p>
            <form action={reviewTimerAction}>
              <input type="hidden" name="engagementId" value={e.id} />
              <input type="hidden" name="timer" value={e.reviewTimerRunning ? "stop" : "start"} />
              <Button type="submit" variant="quiet" className="w-full">
                {e.reviewTimerRunning ? "Pause timer" : "Start timer"}
              </Button>
            </form>
            <form action={addReviewTimeAction} className="mt-3 space-y-2 border-t border-line pt-3">
              <input type="hidden" name="engagementId" value={e.id} />
              <p className="text-xs font-medium">Add time worked outside the platform</p>
              <div className="flex gap-2">
                <input name="minutes" type="number" min={1} max={480} required placeholder="Minutes" className={`${inputClass} w-28`} />
                <input name="note" required placeholder="e.g. Keyed return into Tax990" className={inputClass} />
              </div>
              <Button type="submit" variant="quiet" className="w-full">
                Add time
              </Button>
            </form>
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
