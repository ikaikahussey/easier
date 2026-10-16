"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseForm } from "@/core/fields";
import { consumeLogin, joinWaitlist, requestLogin, sendLoginLink, type WaitlistKind } from "@/core/services/auth";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/services/context";
import {
  acceptConsents,
  claim,
  createEngagement,
  saveReview,
  transition,
  updateIntake,
  uploadDocument,
  MAX_UPLOAD_BYTES,
} from "@/core/services/engagements";
import { addReviewTime, recordInvoice, startReviewTimer, stopReviewTimer } from "@/core/services/operations";
import { setCredentialVerified, submitCredential } from "@/core/services/reviewers";
import { createOrganization } from "@/core/services/organizations";
import { WorkflowError, type Action } from "@/core/workflow";
import { CryptoError } from "@/core/crypto";
import { getProduct } from "@/products";
import { endSession, requireActor, requireAdmin, requireStaff, startSession } from "@/ui/session";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** Known errors become a message on the page; anything else is a generic failure (details stay in server logs). */
function message(err: unknown): string {
  if (err instanceof ValidationError) return err.issues.join(" · ");
  if (err instanceof WorkflowError || err instanceof ForbiddenError) return err.message;
  if (err instanceof NotFoundError || err instanceof CryptoError) return "Not found";
  console.error(err);
  return "Something went wrong. Please try again.";
}

async function attempt(path: string, fn: () => Promise<string | void>): Promise<never> {
  let dest: string;
  try {
    dest = (await fn()) ?? path;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect() control flow
    redirect(`${path}?error=${encodeURIComponent(message(err))}`);
  }
  revalidatePath(path);
  redirect(dest);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function requestLoginAction(fd: FormData) {
  await attempt("/login", async () => {
    const email = str(fd, "email");
    const token = await requestLogin(email);
    if (!token) return "/login?sent=1"; // Same response either way: no hint about who has access.
    const host =
      process.env.VERCEL_ENV === "production"
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL
        : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    const base = process.env.APP_URL || (host ? `https://${host}` : "http://localhost:3000");
    await sendLoginLink(email.trim().toLowerCase(), `${base}/auth/verify?token=${encodeURIComponent(token)}`);
    return "/login?sent=1";
  });
}

export async function joinWaitlistAction(fd: FormData) {
  await attempt("/", async () => {
    await joinWaitlist(str(fd, "email"), str(fd, "kind") as WaitlistKind);
    return "/?joined=1#waitlist";
  });
}

/** Tokens are consumed by POST so link scanners that prefetch emails cannot burn them. */
export async function verifyLoginAction(fd: FormData) {
  const actor = await consumeLogin(str(fd, "token"));
  if (!actor) redirect("/login?error=" + encodeURIComponent("That link is invalid or expired. Request a new one."));
  await startSession(actor.id);
  redirect(actor.role === "client" ? "/app" : "/review");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

// ── Client ───────────────────────────────────────────────────────────────────

export async function createOrganizationAction(fd: FormData) {
  const actor = await requireActor();
  await attempt("/app", async () => {
    await createOrganization(actor, { name: str(fd, "name"), ein: str(fd, "ein"), website: str(fd, "website") });
  });
}

export interface FormState {
  error?: string;
  values?: Record<string, string>;
}

/** Long intake forms return errors with the submitted values so nothing is lost. */
export async function createEngagementAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const orgId = str(fd, "orgId");
  const product = getProduct(str(fd, "product"));
  let id: string;
  try {
    const parsed = parseForm(fd, product.intake);
    if (!parsed.ok) throw new ValidationError(parsed.errors);
    id = await createEngagement(actor, { orgId, product: product.slug, period: str(fd, "period"), intake: parsed.data });
  } catch (err) {
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") values[k] = v;
    return { error: message(err), values };
  }
  redirect(`/engagements/${id}`);
}

export async function updateIntakeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const id = str(fd, "engagementId");
  const product = getProduct(str(fd, "product"));
  try {
    const parsed = parseForm(fd, product.intake);
    if (!parsed.ok) throw new ValidationError(parsed.errors);
    await updateIntake(actor, id, parsed.data);
  } catch (err) {
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") values[k] = v;
    return { error: message(err), values };
  }
  revalidatePath(`/engagements/${id}`);
  redirect(`/engagements/${id}`);
}

export async function uploadDocumentAction(fd: FormData) {
  const actor = await requireActor();
  const id = str(fd, "engagementId");
  await attempt(`/engagements/${id}`, async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError(["Choose a file to upload"]);
    if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError(["File exceeds 5 MB"]);
    await uploadDocument(actor, id, { kind: str(fd, "kind"), filename: file.name, text: await file.text() });
  });
}

export async function acceptConsentsAction(fd: FormData) {
  const actor = await requireActor();
  const id = str(fd, "engagementId");
  await attempt(`/engagements/${id}`, async () => {
    await acceptConsents(actor, id, {
      documents: [...fd.keys()].filter((k) => k.startsWith("accept:") && fd.get(k)).map((k) => k.slice("accept:".length)),
      signerName: str(fd, "signerName"),
      signerTitle: str(fd, "signerTitle"),
    });
  });
}

export async function transitionAction(fd: FormData) {
  const actor = await requireActor();
  const id = str(fd, "engagementId");
  const back = str(fd, "back") === "review" ? `/review/${id}` : `/engagements/${id}`;
  await attempt(back, async () => {
    await transition(actor, id, str(fd, "action") as Action, str(fd, "note") || undefined, {
      submissionId: str(fd, "submissionId") || undefined,
      date: str(fd, "date") || undefined,
    });
  });
}

// ── Staff ────────────────────────────────────────────────────────────────────

export async function claimAction(fd: FormData) {
  const actor = await requireStaff();
  const id = str(fd, "engagementId");
  await attempt(`/review/${id}`, async () => {
    await claim(actor, id);
  });
}

export async function saveReviewAction(fd: FormData) {
  const actor = await requireStaff();
  const id = str(fd, "engagementId");
  await attempt(`/review/${id}`, async () => {
    const mappings: Record<string, string> = {};
    const text: Record<string, string> = {};
    // A value becomes an override if it was already one, or if the reviewer changed it.
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string") continue;
      const [kind, key] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      const wasOverride = str(fd, `src:${kind}:${key}`) === "override";
      const changed = str(fd, `orig:${kind}:${key}`) !== v;
      if (kind === "map" && v && (wasOverride || changed)) mappings[key] = v;
      if (kind === "text" && (wasOverride || changed)) text[key] = v;
    }
    await saveReview(actor, id, { mappings, text });
  });
}

export async function reviewTimerAction(fd: FormData) {
  const actor = await requireStaff();
  const id = str(fd, "engagementId");
  await attempt(`/review/${id}`, async () => {
    if (str(fd, "timer") === "start") await startReviewTimer(actor, id);
    else await stopReviewTimer(actor, id);
  });
}

export async function addReviewTimeAction(fd: FormData) {
  const actor = await requireStaff();
  const id = str(fd, "engagementId");
  await attempt(`/review/${id}`, async () => {
    await addReviewTime(actor, id, Number(str(fd, "minutes")), str(fd, "note"));
  });
}

export async function submitCredentialAction(fd: FormData) {
  const actor = await requireStaff();
  await attempt("/review/profile", async () => {
    await submitCredential(actor, {
      name: str(fd, "name"),
      credentialType: str(fd, "credentialType"),
      credentialNumber: str(fd, "credentialNumber"),
      credentialJurisdiction: str(fd, "credentialJurisdiction"),
      ptin: str(fd, "ptin"),
      efin: str(fd, "efin"),
    });
    return "/review/profile?saved=1";
  });
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function verifyCredentialAction(fd: FormData) {
  const actor = await requireAdmin();
  await attempt("/admin", async () => {
    await setCredentialVerified(actor, str(fd, "reviewerId"), str(fd, "verified") === "yes");
  });
}

export async function recordInvoiceAction(fd: FormData) {
  const actor = await requireAdmin();
  await attempt("/admin", async () => {
    await recordInvoice(actor, str(fd, "engagementId"), {
      amount: str(fd, "amount"),
      issuedOn: str(fd, "issuedOn"),
      paidOn: str(fd, "paidOn") || undefined,
      reference: str(fd, "reference") || undefined,
    });
  });
}
