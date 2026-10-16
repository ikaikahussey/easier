import Link from "next/link";
import { recordInvoiceAction, verifyCredentialAction } from "@/app/actions";
import { formatUsdCents } from "@/core/money";
import { formatDuration } from "@/core/review-time";
import { pilotMetrics } from "@/core/services/operations";
import { listReviewers } from "@/core/services/reviewers";
import { STATUSES, type Status } from "@/core/workflow";
import { Button, Card, Notice, PageTitle, Shell, StatusBadge, inputClass } from "@/ui/components";
import { requireAdmin } from "@/ui/session";

/** The pilot gate: a full Form 990 must take a reviewer under this many hours. */
const GATE_HOURS = 6;
const SIGNED = ["approved", "delivered", "filed", "accepted", "rejected"];

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireAdmin();
  const { error } = await searchParams;
  const [m, reviewers] = await Promise.all([pilotMetrics(actor), listReviewers(actor)]);
  const who = new Map(reviewers.map((r) => [r.id, r.name ?? r.email]));
  const full990 = m.signed.find((s) => s.tier === "Form 990");
  const pledgeAccrued = m.rows.filter((r) => SIGNED.includes(r.status)).reduce((t, r) => t + r.pledgeCents, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Shell actor={actor}>
      <PageTitle kicker="Pilot operations">Admin</PageTitle>
      <Notice error={error} />

      <Card title="Pilot gate">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Full 990, mean reviewer hours</dt>
            <dd className={`text-2xl font-bold tabular-nums ${full990 && full990.meanHours > GATE_HOURS ? "text-danger" : ""}`}>
              {full990 ? full990.meanHours : "—"}
            </dd>
            <dd className="text-xs text-muted">
              Target under {GATE_HOURS}. {full990 ? `${full990.count} signed, max ${full990.maxHours} h.` : "None signed yet."}
            </dd>
          </div>
          <div>
            <dt className="text-muted">IRS accepted / rejected</dt>
            <dd className="text-2xl font-bold tabular-nums">
              {m.accepted} / {m.rejected}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Invoiced / paid</dt>
            <dd className="text-2xl font-bold tabular-nums">{formatUsdCents(m.invoicedCents)}</dd>
            <dd className="text-xs text-muted">{formatUsdCents(m.paidCents)} paid</dd>
          </div>
          <div>
            <dt className="text-muted">Labor Pledge accrued</dt>
            <dd className="text-2xl font-bold tabular-nums">{formatUsdCents(pledgeAccrued)}</dd>
            <dd className="text-xs text-muted">On signed work; payable when the recipient fund is chosen.</dd>
          </div>
        </dl>
        {m.signed.length > 0 && (
          <table className="data-table mt-4 w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2">Form</th>
                <th className="text-right">Signed</th>
                <th className="text-right">Mean hours</th>
                <th className="text-right">Max hours</th>
              </tr>
            </thead>
            <tbody>
              {m.signed.map((s) => (
                <tr key={s.tier}>
                  <td className="py-1.5">{s.tier}</td>
                  <td className="text-right tabular-nums">{s.count}</td>
                  <td className="text-right tabular-nums">{s.meanHours}</td>
                  <td className="text-right tabular-nums">{s.maxHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Engagements">
        {m.rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2">Client</th>
                  <th>Form</th>
                  <th>Reviewer</th>
                  <th className="text-right">Time</th>
                  <th className="text-right">Fee</th>
                  <th>E-file</th>
                  <th>Invoice</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 align-top">
                    <td className="py-2">
                      <Link href={`/review/${r.id}`} className="font-bold">
                        {r.orgName}
                      </Link>
                      <div className="text-xs text-muted">{r.period}</div>
                    </td>
                    <td>{r.formType}</td>
                    <td>{r.assignedReviewerId ? who.get(r.assignedReviewerId) ?? "—" : "Unassigned"}</td>
                    <td className="text-right tabular-nums">
                      {formatDuration(r.reviewSeconds)}
                      {r.timerRunning && " ●"}
                    </td>
                    <td className="text-right tabular-nums">{formatUsdCents(r.feeCents)}</td>
                    <td className="font-mono text-xs">{r.submissionId ?? "—"}</td>
                    <td>
                      {r.invoice && (
                        <p className="text-xs">
                          {formatUsdCents(r.invoice.amountCents)} issued {r.invoice.issuedOn}
                          {r.invoice.paidOn ? `, paid ${r.invoice.paidOn}` : ", unpaid"}
                        </p>
                      )}
                      <details className="text-xs">
                        <summary className="cursor-pointer">{r.invoice ? "Update" : "Record invoice"}</summary>
                        <form action={recordInvoiceAction} className="mt-2 space-y-1">
                          <input type="hidden" name="engagementId" value={r.id} />
                          <input
                            name="amount"
                            required
                            defaultValue={((r.invoice?.amountCents ?? r.feeCents) / 100).toFixed(2)}
                            aria-label="Amount in dollars"
                            className={`${inputClass} py-1`}
                          />
                          <input name="issuedOn" type="date" required defaultValue={r.invoice?.issuedOn ?? today} aria-label="Issued on" className={`${inputClass} py-1`} />
                          <input name="paidOn" type="date" defaultValue={r.invoice?.paidOn ?? ""} aria-label="Paid on" className={`${inputClass} py-1`} />
                          <input name="reference" placeholder="Reference" defaultValue={r.invoice?.reference ?? ""} className={`${inputClass} py-1`} />
                          <Button type="submit" variant="quiet">
                            Save invoice
                          </Button>
                        </form>
                      </details>
                    </td>
                    <td className="text-right">
                      <StatusBadge status={r.status as Status} label={STATUSES[r.status as Status].label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No submitted engagements yet.</p>
        )}
      </Card>

      <Card title="Reviewers">
        <p className="mb-3 text-xs text-muted">
          Check each credential with the issuing body before verifying: the IRS enrolled agent and PTIN records for an EA, the
          state board of accountancy for a CPA. Only verified reviewers can sign. You cannot verify your own credential.
        </p>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2">Reviewer</th>
                <th>Credential</th>
                <th>PTIN</th>
                <th>EFIN</th>
                <th>Verified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviewers.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2">
                    {r.name ?? "—"}
                    <div className="text-xs text-muted">{r.email}</div>
                  </td>
                  <td>
                    {r.credentialType ? `${r.credentialType} ${r.credentialNumber} (${r.credentialJurisdiction})` : "Not submitted"}
                  </td>
                  <td className="font-mono text-xs">{r.ptin ?? "—"}</td>
                  <td className="font-mono text-xs">{r.efin ?? "—"}</td>
                  <td>{r.verifiedAt ? r.verifiedAt.toISOString().slice(0, 10) : "No"}</td>
                  <td>
                    {r.credentialType && r.id !== actor.id && (
                      <form action={verifyCredentialAction}>
                        <input type="hidden" name="reviewerId" value={r.id} />
                        <input type="hidden" name="verified" value={r.verifiedAt ? "no" : "yes"} />
                        <Button type="submit" variant={r.verifiedAt ? "danger" : "primary"}>
                          {r.verifiedAt ? "Revoke" : "Verify"}
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}
