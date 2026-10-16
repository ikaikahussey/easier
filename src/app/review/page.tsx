import Link from "next/link";
import { listEngagements } from "@/core/services/engagements";
import { formatUsd } from "@/core/money";
import { formatDuration } from "@/core/review-time";
import { getProduct } from "@/products";
import { Card, Shell, StatusBadge } from "@/ui/components";
import { requireStaff } from "@/ui/session";

export default async function Queue() {
  const actor = await requireStaff();
  const listed = await listEngagements(actor, {
    statuses: ["in_review", "changes_requested", "approved", "delivered", "filed", "rejected"],
  });
  // Delivered work stays in the queue only while it still has to be e-filed.
  const all = listed.filter((e) => e.status !== "delivered" || getProduct(e.product).filedWithIrs);
  const mine = all.filter((e) => e.assignedReviewerId === actor.id);
  const open = all.filter((e) => !e.assignedReviewerId);

  const List = ({ items, empty }: { items: typeof all; empty: string }) =>
    items.length ? (
      <table className="data-table w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-2">Client</th>
            <th>Product</th>
            <th>Due</th>
            <th className="text-right">Must fix</th>
            <th className="text-right">Review time</th>
            <th className="text-right">Fee</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b border-line/60">
              <td className="py-2">
                <Link href={`/review/${e.id}`} className="font-bold">
                  {e.orgName}
                </Link>
              </td>
              <td>
                {e.productName} · {e.period}
              </td>
              <td className="tabular-nums">{e.extendedDueDate ?? e.dueDate ?? "—"}</td>
              <td className={`text-right tabular-nums ${e.errorCount ? "text-danger" : ""}`}>{e.errorCount}</td>
              <td className="text-right tabular-nums">
                {formatDuration(e.reviewSeconds)}
                {e.reviewTimerRunning && " ●"}
              </td>
              <td className="text-right tabular-nums">{formatUsd(e.quote.total)}</td>
              <td className="text-right">
                <StatusBadge status={e.status} label={e.statusLabel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="text-sm text-muted">{empty}</p>
    );

  return (
    <Shell actor={actor}>
      <h1 className="mb-6 text-3xl font-semibold">Review queue</h1>
      <Card title="Assigned to you">
        <List items={mine} empty="Nothing assigned. Claim work from the unassigned list." />
      </Card>
      <Card title="Unassigned">
        <List items={open} empty="The queue is clear." />
      </Card>
    </Shell>
  );
}
