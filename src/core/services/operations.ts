import { and, eq, inArray, sql } from "drizzle-orm";
import { isIsoDate } from "../dates";
import { withSystem, withTenant } from "../db/client";
import { engagements, organizations, type Invoice } from "../db/schema";
import { elapsedSeconds, MAX_MANUAL_MINUTES } from "../review-time";
import { WorkflowError } from "../workflow";
import { getProduct } from "@/products";
import { ForbiddenError, isStaff, NotFoundError, principal, ValidationError, vaultFor, type Actor } from "./context";
import { assertCanAct, loadRow, logEvent } from "./engagements";

/**
 * Pilot operations: the reviewer time log, manual invoices, and the metrics the pilot is
 * judged on. Times and invoices are engagement metadata, not client content.
 */

function requireStaff(actor: Actor) {
  if (!isStaff(actor)) throw new ForbiddenError("Only staff can record review time");
}

/** Start (or resume) the assigned reviewer's timer. */
export async function startReviewTimer(actor: Actor, engagementId: string): Promise<void> {
  requireStaff(actor);
  await withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (e.reviewStartedAt) return;
    if (e.status === "awaiting_documents" || e.status === "changes_requested")
      throw new WorkflowError("The client has this engagement; start the timer once it is back in review");
    await tx.update(engagements).set({ reviewStartedAt: new Date() }).where(eq(engagements.id, e.id));
    await logEvent(tx, await vaultFor(tx, e.orgId), e, actor, "timer_started");
  });
}

/** Pause the timer and add the elapsed time (capped at 4 hours per session). */
export async function stopReviewTimer(actor: Actor, engagementId: string): Promise<number> {
  requireStaff(actor);
  return withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (!e.reviewStartedAt) return 0;
    const seconds = elapsedSeconds(e.reviewStartedAt);
    // Only the stop that still sees this start time counts it, so concurrent stops cannot double-count.
    const stopped = await tx
      .update(engagements)
      .set({ reviewSeconds: sql`${engagements.reviewSeconds} + ${seconds}`, reviewStartedAt: null })
      .where(and(eq(engagements.id, e.id), eq(engagements.reviewStartedAt, e.reviewStartedAt)))
      .returning({ id: engagements.id });
    if (!stopped.length) return 0;
    await logEvent(tx, await vaultFor(tx, e.orgId), e, actor, "timer_stopped", { seconds });
    return seconds;
  });
}

/** Record time spent outside the platform, such as keying the return into e-file software. */
export async function addReviewTime(actor: Actor, engagementId: string, minutes: number, note: string): Promise<void> {
  requireStaff(actor);
  const issues = [
    !(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MANUAL_MINUTES) &&
      `Enter whole minutes from 1 to ${MAX_MANUAL_MINUTES}`,
    !note.trim() && "Describe the work",
  ].filter(Boolean) as string[];
  if (issues.length) throw new ValidationError(issues);
  await withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    await tx
      .update(engagements)
      .set({ reviewSeconds: sql`${engagements.reviewSeconds} + ${minutes * 60}` })
      .where(eq(engagements.id, e.id));
    await logEvent(tx, await vaultFor(tx, e.orgId), e, actor, "time_added", { minutes, note: note.trim().slice(0, 500) });
  });
}

/** Admins record the invoice for an engagement. Billing metadata only; no payment processing. */
export async function recordInvoice(
  actor: Actor,
  engagementId: string,
  input: { amount: string; issuedOn: string; paidOn?: string; reference?: string },
): Promise<void> {
  if (actor.role !== "admin") throw new ForbiddenError("Only admins record invoices");
  const amountCents = Math.round(Number(input.amount.replace(/[$,\s]/g, "")) * 100);
  const issues = [
    !(Number.isFinite(amountCents) && amountCents > 0) && "Enter the invoice amount in dollars",
    !isIsoDate(input.issuedOn) && "Enter the issue date as YYYY-MM-DD",
    input.paidOn && !isIsoDate(input.paidOn) && "Enter the paid date as YYYY-MM-DD",
    input.paidOn && input.paidOn < input.issuedOn && "The paid date is before the issue date",
  ].filter(Boolean) as string[];
  if (issues.length) throw new ValidationError(issues);
  const invoice: Invoice = {
    amountCents,
    issuedOn: input.issuedOn,
    ...(input.paidOn ? { paidOn: input.paidOn } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim().slice(0, 80) } : {}),
  };
  await withSystem(async (tx) => {
    const [e] = await tx
      .update(engagements)
      .set({ invoice, updatedAt: new Date() })
      .where(eq(engagements.id, engagementId))
      .returning({ id: engagements.id, orgId: engagements.orgId });
    if (!e) throw new NotFoundError("Engagement not found");
    await logEvent(tx, undefined, e, actor, invoice.paidOn ? "invoice_paid" : "invoice_issued");
  });
}

export interface PilotRow {
  id: string;
  orgName: string;
  productName: string;
  formType: string;
  period: string;
  status: string;
  assignedReviewerId: string | null;
  reviewSeconds: number;
  timerRunning: boolean;
  feeCents: number;
  pledgeCents: number;
  invoice: Invoice | null;
  submissionId?: string;
  filingResult?: string;
}

export interface PilotMetrics {
  rows: PilotRow[];
  /** Approved or later, counted by quote tier (e.g. "Form 990"). */
  signed: { tier: string; count: number; meanHours: number; maxHours: number }[];
  accepted: number;
  rejected: number;
  invoicedCents: number;
  paidCents: number;
}

const SIGNED_STATUSES = ["approved", "delivered", "filed", "accepted", "rejected"];

/** Pilot dashboard for admins: reviewer hours per return, filing outcomes, invoices. */
export async function pilotMetrics(actor: Actor): Promise<PilotMetrics> {
  if (actor.role !== "admin") throw new ForbiddenError("Only admins see pilot metrics");
  return withTenant(principal(actor), async (tx) => {
    const list = await tx
      .select({ e: engagements, orgName: organizations.name })
      .from(engagements)
      .innerJoin(organizations, eq(organizations.id, engagements.orgId))
      .where(inArray(engagements.status, ["in_review", "changes_requested", ...SIGNED_STATUSES]));
    const rows: PilotRow[] = list.map(({ e, orgName }) => {
      const quote = e.quote as { tier: string; total: number; pledge?: { contribution: number } };
      return {
        id: e.id,
        orgName,
        productName: getProduct(e.product).name,
        formType: quote.tier,
        period: e.period,
        status: e.status,
        assignedReviewerId: e.assignedReviewerId,
        reviewSeconds: e.reviewSeconds + (e.reviewStartedAt ? elapsedSeconds(e.reviewStartedAt) : 0),
        timerRunning: !!e.reviewStartedAt,
        feeCents: quote.total,
        pledgeCents: quote.pledge?.contribution ?? 0,
        invoice: e.invoice ?? null,
        submissionId: e.filing?.submissionId,
        filingResult: e.filing?.result,
      };
    });
    const byTier = new Map<string, number[]>();
    for (const r of rows.filter((r) => SIGNED_STATUSES.includes(r.status)))
      byTier.set(r.formType, [...(byTier.get(r.formType) ?? []), r.reviewSeconds / 3600]);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      rows: rows.sort((a, b) => a.orgName.localeCompare(b.orgName)),
      signed: [...byTier].map(([tier, h]) => ({
        tier,
        count: h.length,
        meanHours: round(h.reduce((a, b) => a + b, 0) / h.length),
        maxHours: round(Math.max(...h)),
      })),
      accepted: rows.filter((r) => r.status === "accepted").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      invoicedCents: rows.reduce((t, r) => t + (r.invoice?.amountCents ?? 0), 0),
      paidCents: rows.reduce((t, r) => t + (r.invoice?.paidOn ? r.invoice.amountCents : 0), 0),
    };
  });
}
