import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { sha256, type OrgVault } from "../crypto";
import { withSystem, withTenant, type Tx } from "../db/client";
import { documents, drafts, engagements, events, organizations } from "../db/schema";
import { buildDraft } from "../draft";
import { formSchema } from "../fields";
import { emptyOverrides, priceEngagement, type DraftSnapshot, type OrgProfile, type Overrides, type PriorYear, type Quote } from "../product";
import { blocking } from "../rules";
import { availableActions, nextStatus, STATUSES, WorkflowError, type Action, type Status } from "../workflow";
import { getProduct } from "@/products";
import {
  ForbiddenError,
  getDeps,
  isStaff,
  NotFoundError,
  principal,
  ValidationError,
  vaultFor,
  type Actor,
} from "./context";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface EngagementSummary {
  id: string;
  orgId: string;
  orgName: string;
  product: string;
  productName: string;
  productLine: string;
  period: string;
  status: Status;
  statusLabel: string;
  dueDate: string | null;
  extendedDueDate: string | null;
  quote: Quote;
  assignedReviewerId: string | null;
  errorCount: number;
  warningCount: number;
  updatedAt: Date;
}

export interface EngagementDetail extends EngagementSummary {
  /** False for staff who have not claimed the engagement: content stays sealed. */
  accessible: boolean;
  intake?: unknown;
  documents: { id: string; kind: string; filename: string; size: number; createdAt: Date }[];
  draft?: { version: number; snapshot: DraftSnapshot; overrides: Overrides; createdAt: Date };
  events: { type: string; actorId: string | null; payload?: Record<string, unknown>; createdAt: Date }[];
  actions: Action[];
}

type EngagementRow = typeof engagements.$inferSelect;

function summary(r: EngagementRow, orgName: string): EngagementSummary {
  const p = getProduct(r.product);
  const status = r.status as Status;
  return {
    id: r.id,
    orgId: r.orgId,
    orgName,
    product: r.product,
    productName: p.name,
    productLine: p.line,
    period: r.period,
    status,
    statusLabel: STATUSES[status].label,
    dueDate: r.dueDate,
    extendedDueDate: r.extendedDueDate,
    quote: r.quote as Quote,
    assignedReviewerId: r.assignedReviewerId,
    errorCount: r.errorCount,
    warningCount: r.warningCount,
    updatedAt: r.updatedAt,
  };
}

const ctx = {
  intake: (id: string) => `engagements:${id}:intake`,
  docContent: (id: string) => `documents:${id}:content`,
  docParsed: (id: string) => `documents:${id}:parsed`,
  snapshot: (id: string) => `drafts:${id}:snapshot`,
  overrides: (id: string) => `drafts:${id}:overrides`,
  event: (id: string) => `events:${id}:payload`,
};

async function loadRow(tx: Tx, id: string) {
  const [row] = await tx
    .select({ e: engagements, orgName: organizations.name })
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(eq(engagements.id, id));
  if (!row) throw new NotFoundError("Engagement not found");
  return row;
}

async function logEvent(
  tx: Tx,
  vault: OrgVault | undefined,
  e: Pick<EngagementRow, "id" | "orgId">,
  actor: Actor | undefined,
  type: string,
  payload?: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  await tx.insert(events).values({
    id,
    orgId: e.orgId,
    engagementId: e.id,
    actorId: actor?.id ?? null,
    type,
    payloadEnc: payload && vault ? vault.seal(payload, ctx.event(id)) : null,
  });
}

/** Assigned staff and members may act; unassigned staff may only see queue metadata. */
function assertCanAct(actor: Actor, e: EngagementRow) {
  if (isStaff(actor) && e.assignedReviewerId !== actor.id)
    throw new ForbiddenError("Claim this engagement before working on it");
}

async function latestDraft(tx: Tx, vault: OrgVault, engagementId: string) {
  const [d] = await tx
    .select()
    .from(drafts)
    .where(eq(drafts.engagementId, engagementId))
    .orderBy(desc(drafts.version))
    .limit(1);
  if (!d) return undefined;
  return {
    version: d.version,
    snapshot: vault.open<DraftSnapshot>(d.snapshotEnc, ctx.snapshot(d.id)),
    overrides: vault.open<Overrides>(d.overridesEnc, ctx.overrides(d.id)),
    createdAt: d.createdAt,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listEngagements(
  actor: Actor,
  filter: { orgId?: string; statuses?: Status[] } = {},
): Promise<EngagementSummary[]> {
  return withTenant(principal(actor), async (tx) => {
    const conds = [
      filter.orgId ? eq(engagements.orgId, filter.orgId) : undefined,
      filter.statuses?.length ? inArray(engagements.status, filter.statuses) : undefined,
    ].filter((c) => c !== undefined);
    const rows = await tx
      .select({ e: engagements, orgName: organizations.name })
      .from(engagements)
      .innerJoin(organizations, eq(organizations.id, engagements.orgId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(engagements.dueDate), asc(engagements.createdAt));
    return rows.map((r) => summary(r.e, r.orgName));
  });
}

export async function getEngagement(actor: Actor, id: string): Promise<EngagementDetail> {
  return withTenant(principal(actor), async (tx) => {
    const { e, orgName } = await loadRow(tx, id);
    const base = summary(e, orgName);
    const actions = availableActions(base.status, actor.role);
    if (isStaff(actor) && e.assignedReviewerId !== actor.id)
      return { ...base, accessible: false, documents: [], events: [], actions: [] };

    const vault = await vaultFor(tx, e.orgId);
    if (isStaff(actor)) await logEvent(tx, vault, e, actor, "staff_viewed");

    const docs = await tx
      .select({ id: documents.id, kind: documents.kind, filename: documents.filename, size: documents.size, createdAt: documents.createdAt })
      .from(documents)
      .where(eq(documents.engagementId, id))
      .orderBy(desc(documents.createdAt));
    const evts = await tx.select().from(events).where(eq(events.engagementId, id)).orderBy(desc(events.createdAt));

    return {
      ...base,
      accessible: true,
      intake: vault.open(e.intakeEnc, ctx.intake(e.id)),
      documents: docs,
      draft: await latestDraft(tx, vault, id),
      events: evts.map((x) => ({
        type: x.type,
        actorId: x.actorId,
        payload: x.payloadEnc ? vault.open<Record<string, unknown>>(x.payloadEnc, ctx.event(x.id)) : undefined,
        createdAt: x.createdAt,
      })),
      actions,
    };
  });
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function createEngagement(
  actor: Actor,
  input: { orgId: string; product: string; period: string; intake: unknown },
): Promise<string> {
  if (isStaff(actor)) throw new ForbiddenError("Engagements are opened by the client organization");
  const product = getProduct(input.product);
  const period = formSchema([{ title: "", fields: [product.period] }]).safeParse({ period: input.period });
  if (!period.success) throw new ValidationError([`${product.period.label} is invalid`]);
  const intake = formSchema(product.intake).safeParse(input.intake);
  if (!intake.success) throw new ValidationError(intake.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));

  const due = product.deadline?.(input.period);
  return withTenant(principal(actor), async (tx) => {
    const vault = await vaultFor(tx, input.orgId);
    const id = crypto.randomUUID();
    const row = {
      id,
      orgId: input.orgId,
      product: product.slug,
      period: input.period,
      status: "awaiting_documents" as Status,
      intakeEnc: vault.seal(intake.data, ctx.intake(id)),
      quote: priceEngagement(product, intake.data),
      dueDate: due?.original ?? null,
      extendedDueDate: due?.extended ?? null,
    };
    try {
      await tx.insert(engagements).values(row);
    } catch (err) {
      if (/engagements_org_product_period/.test(String((err as { cause?: unknown }).cause ?? err)))
        throw new ValidationError([`A ${product.name} engagement already exists for ${input.period}`]);
      throw err;
    }
    await logEvent(tx, vault, row, actor, "created", { product: product.slug, period: input.period });
    return id;
  });
}

/** Clients may revise their answers until the engagement is in review (e.g. to add schedule detail). */
export async function updateIntake(actor: Actor, engagementId: string, intake: unknown): Promise<void> {
  if (isStaff(actor)) throw new ForbiddenError("Answers are edited by the client organization");
  await withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (!["awaiting_documents", "changes_requested"].includes(e.status))
      throw new WorkflowError("Answers can no longer be changed for this engagement");
    const product = getProduct(e.product);
    const parsed = formSchema(product.intake).safeParse(intake);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const vault = await vaultFor(tx, e.orgId);
    await tx
      .update(engagements)
      .set({
        intakeEnc: vault.seal(parsed.data, ctx.intake(e.id)),
        quote: priceEngagement(product, parsed.data),
        updatedAt: new Date(),
      })
      .where(eq(engagements.id, e.id));
    await logEvent(tx, vault, e, actor, "intake_updated");
  });
}

export async function uploadDocument(
  actor: Actor,
  engagementId: string,
  file: { kind: string; filename: string; text: string },
): Promise<void> {
  const bytes = Buffer.byteLength(file.text);
  if (bytes > MAX_UPLOAD_BYTES) throw new ValidationError(["File exceeds 5 MB"]);
  await withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (!["awaiting_documents", "changes_requested", "in_review"].includes(e.status))
      throw new WorkflowError("Documents can no longer be changed for this engagement");
    const kind = getProduct(e.product).documents.find((d) => d.kind === file.kind);
    if (!kind) throw new ValidationError([`Unknown document type: ${file.kind}`]);
    let parsed: unknown;
    try {
      parsed = kind.parse(file.text);
    } catch (err) {
      throw new ValidationError([`${kind.label}: ${(err as Error).message}`]);
    }
    const vault = await vaultFor(tx, e.orgId);
    const id = crypto.randomUUID();
    await tx.insert(documents).values({
      id,
      orgId: e.orgId,
      engagementId: e.id,
      kind: kind.kind,
      filename: file.filename.slice(0, 200),
      size: bytes,
      sha256: sha256(file.text),
      contentEnc: vault.seal(file.text, ctx.docContent(id)),
      parsedEnc: vault.seal(parsed, ctx.docParsed(id)),
      createdBy: actor.id,
    });
    await logEvent(tx, vault, e, actor, "document_uploaded", { kind: kind.kind, filename: file.filename });
  });
}

/** Build a new draft version from the latest documents and the given overrides. */
async function rebuild(tx: Tx, actor: Actor, e: EngagementRow, vault: OrgVault, overrides?: Overrides) {
  const product = getProduct(e.product);
  const docs = await tx.select().from(documents).where(eq(documents.engagementId, e.id)).orderBy(desc(documents.createdAt));
  const latest: Record<string, unknown> = {};
  for (const d of docs) if (!(d.kind in latest)) latest[d.kind] = vault.open(d.parsedEnc, ctx.docParsed(d.id));
  const missing = product.documents.filter((k) => k.required && !(k.kind in latest));
  if (missing.length) throw new ValidationError(missing.map((k) => `${k.label} is required`));

  const [org] = await tx.select().from(organizations).where(eq(organizations.id, e.orgId));
  const prev = await latestDraft(tx, vault, e.id);
  const periodYear = Number(e.period.slice(0, 4));
  const prior = ((org!.publicFilings as PriorYear[]) ?? []).filter((p) => p.year < periodYear);

  const snapshot = await buildDraft(
    product,
    {
      org: { ...(org!.profile as OrgProfile), name: org!.name, ein: org!.ein ?? undefined },
      period: e.period,
      intake: vault.open(e.intakeEnc, ctx.intake(e.id)),
      documents: latest,
      overrides: overrides ?? prev?.overrides ?? emptyOverrides(),
      prior,
    },
    { llm: getDeps().llm, priorAi: prev?.snapshot.ai },
  );

  const id = crypto.randomUUID();
  const version = (prev?.version ?? 0) + 1;
  await tx.insert(drafts).values({
    id,
    orgId: e.orgId,
    engagementId: e.id,
    version,
    snapshotEnc: vault.seal(snapshot, ctx.snapshot(id)),
    overridesEnc: vault.seal(overrides ?? prev?.overrides ?? emptyOverrides(), ctx.overrides(id)),
    createdBy: actor.id,
  });
  const errorCount = blocking(snapshot.findings).length;
  const warningCount = snapshot.findings.filter((f) => f.severity === "warning").length;
  await tx
    .update(engagements)
    .set({
      errorCount,
      warningCount,
      quote: priceEngagement(product, vault.open(e.intakeEnc, ctx.intake(e.id)), snapshot.data),
      updatedAt: new Date(),
    })
    .where(eq(engagements.id, e.id));
  await logEvent(tx, vault, e, actor, "draft_built", {
    version,
    errors: errorCount,
    warnings: warningCount,
    models: [...new Set(snapshot.ai.map((r) => r.model))],
  });
  return { snapshot, errorCount };
}

/** Workflow transitions. Submitting builds the AI draft; approval requires zero blocking findings. */
export async function transition(actor: Actor, engagementId: string, action: Action, note?: string): Promise<Status> {
  return withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    const vault = await vaultFor(tx, e.orgId);
    let errorCount = e.errorCount;
    if (action === "submit") {
      nextStatus(e.status as Status, action, { role: actor.role, errorCount: 0 }); // validate before spending AI calls
      errorCount = (await rebuild(tx, actor, e, vault)).errorCount;
    }
    const to = nextStatus(e.status as Status, action, { role: actor.role, errorCount, note });
    await tx.update(engagements).set({ status: to, updatedAt: new Date() }).where(eq(engagements.id, e.id));
    await logEvent(tx, vault, e, actor, `status:${action}`, { from: e.status, to, ...(note ? { note } : {}) });
    return to;
  });
}

/** Reviewer edits (reclassifications, narrative text) produce a new draft version. */
export async function saveReview(actor: Actor, engagementId: string, overrides: Overrides): Promise<DraftSnapshot> {
  if (!isStaff(actor)) throw new ForbiddenError("Only reviewers can edit drafts");
  return withTenant(principal(actor), async (tx) => {
    const { e } = await loadRow(tx, engagementId);
    assertCanAct(actor, e);
    if (e.status !== "in_review") throw new WorkflowError("Drafts can be edited only while in review");
    const vault = await vaultFor(tx, e.orgId);
    const prev = await latestDraft(tx, vault, e.id);
    const { snapshot } = await rebuild(tx, actor, e, vault, overrides);
    await logEvent(tx, vault, e, actor, "review_saved", {
      reclassified: Object.keys(overrides.mappings).filter((k) => prev?.overrides.mappings[k] !== overrides.mappings[k]),
      editedText: Object.keys(overrides.text).filter((k) => prev?.overrides.text[k] !== overrides.text[k]),
    });
    return snapshot;
  });
}

/**
 * Assign an engagement to a reviewer. Privileged because assignment is what grants the
 * reviewer read access; only staff can claim, and only unclaimed work unless admin.
 */
export async function claim(actor: Actor, engagementId: string, reviewerId = actor.id): Promise<void> {
  if (!isStaff(actor)) throw new ForbiddenError("Only staff can claim engagements");
  if (reviewerId !== actor.id && actor.role !== "admin") throw new ForbiddenError("Only admins can assign others");
  await withSystem(async (tx) => {
    const where =
      actor.role === "admin"
        ? eq(engagements.id, engagementId)
        : and(eq(engagements.id, engagementId), or(isNull(engagements.assignedReviewerId), eq(engagements.assignedReviewerId, actor.id)));
    const updated = await tx
      .update(engagements)
      .set({ assignedReviewerId: reviewerId, updatedAt: new Date() })
      .where(where)
      .returning({ id: engagements.id, orgId: engagements.orgId });
    if (!updated.length) throw new ForbiddenError("Engagement is already assigned");
    await logEvent(tx, undefined, updated[0]!, actor, reviewerId === actor.id ? "claimed" : "assigned");
  });
}
