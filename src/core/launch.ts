/**
 * Launch readiness: what must be true of a deployment before the public can sign up, and which
 * service lines can take a customer today. Pure functions of the environment, with no imports,
 * so `scripts/preflight.mjs` can load this file directly during the Vercel build.
 */

export type Env = Record<string, string | undefined>;

export interface LaunchCheck {
  id: string;
  label: string;
  ok: boolean;
  /** A failed blocking check stops a production build when SITE_ACCESS=open. */
  blocking: boolean;
  /** What to do when it fails; what was found when it passes. */
  detail: string;
}

export const siteAccessOpen = (env: Env = process.env) => env.SITE_ACCESS === "open";

const has = (v: string | undefined) => !!v?.trim();

function keyBytes(v: string | undefined): number {
  if (!has(v)) return 0;
  try {
    return Buffer.from(v!.trim(), "base64").length;
  } catch {
    return 0;
  }
}

/** Whether sign-in and confirmation emails reach an inbox (as opposed to the server log). */
export const mailDelivers = (env: Env = process.env) => has(env.RESEND_API_KEY) && env.MAIL_TRANSPORT !== "log";

/** The address links in emails point to. Mirrors `linkUrl` in the auth actions. */
export function publicBaseUrl(env: Env = process.env): string | undefined {
  if (has(env.APP_URL)) return env.APP_URL!.trim();
  const host = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

// ── Service lines ────────────────────────────────────────────────────────────

export interface LineStatus {
  slug: string;
  /** True when a member of the public can start this line today. */
  open: boolean;
  /** Why not, in words a visitor can read. Empty when open. */
  reason: string;
}

/** Engagement products need a named, licensed preparer before a client can accept terms. */
export const preparerNamed = (env: Env = process.env) => has(env.PREPARER_OF_RECORD);

/**
 * `needsPreparer` is true for a product whose engagement terms name the preparer of record
 * (every product with consents). Programs pass their own feature flag as `enabled`.
 */
export function lineStatus(line: { slug: string; needsPreparer?: boolean; enabled?: boolean }, env: Env = process.env): LineStatus {
  if (line.enabled === false) return { slug: line.slug, open: false, reason: "Not yet offered." };
  if (line.needsPreparer && !preparerNamed(env))
    return { slug: line.slug, open: false, reason: "Opening soon. We take engagements once the licensed professional who signs the work is named." };
  return { slug: line.slug, open: true, reason: "" };
}

// ── Deployment checks ────────────────────────────────────────────────────────

export interface LaunchInputs {
  /** Slugs of the lines `lineStatus` reports open. */
  openLines: string[];
  /** Legal documents whose version still says "draft" (awaiting counsel). */
  draftDocuments: string[];
}

export function launchChecks(env: Env = process.env, inputs: LaunchInputs = { openLines: [], draftDocuments: [] }): LaunchCheck[] {
  const base = publicBaseUrl(env);
  const admins = (env.ADMIN_EMAILS ?? "").split(",").filter((s) => s.trim()).length;
  const check = (id: string, label: string, ok: boolean, blocking: boolean, pass: string, fail: string): LaunchCheck => ({
    id,
    label,
    ok,
    blocking,
    detail: ok ? pass : fail,
  });
  return [
    check("database", "Production database", has(env.DATABASE_URL), true, "DATABASE_URL is set.", "Set DATABASE_URL to the production Neon database."),
    check(
      "encryption-key",
      "Client data encryption key",
      keyBytes(env.DATA_ENCRYPTION_KEY) === 32,
      true,
      "DATA_ENCRYPTION_KEY is 32 bytes.",
      "Set DATA_ENCRYPTION_KEY to 32 random bytes, base64 (openssl rand -base64 32).",
    ),
    check(
      "session-secret",
      "Session signing secret",
      (env.SESSION_SECRET ?? "").length >= 32,
      true,
      "SESSION_SECRET is 32 or more characters.",
      "Set SESSION_SECRET to 32 or more random characters.",
    ),
    check(
      "mail",
      "Email delivery",
      mailDelivers(env),
      true,
      "Sign-in and confirmation links are sent through Resend.",
      env.MAIL_TRANSPORT === "log"
        ? "MAIL_TRANSPORT=log prints links to the server log. Remove it; a new account cannot confirm its email."
        : "Set RESEND_API_KEY. Without it a new account cannot confirm its email.",
    ),
    check(
      "base-url",
      "Public address",
      !!base && base.startsWith("https://"),
      true,
      `Emailed links point to ${base}.`,
      "Set APP_URL to the https address of the site.",
    ),
    check(
      "contact",
      "Contact address",
      has(env.CONTACT_EMAIL),
      true,
      `The terms and privacy policy direct requests to ${env.CONTACT_EMAIL?.trim()}.`,
      "Set CONTACT_EMAIL. The terms and privacy policy must say where to send questions and privacy requests.",
    ),
    check("admin", "An administrator", admins > 0, true, `${admins} admin email(s) configured.`, "Set ADMIN_EMAILS so someone can verify credentials and record invoices."),
    check(
      "open-line",
      "A service line that can take a customer",
      inputs.openLines.length > 0,
      true,
      `Open: ${inputs.openLines.join(", ")}.`,
      "No line is open. Set PREPARER_OF_RECORD (Tax, Books) or P120_ENABLED=1 (Part 120).",
    ),
    check(
      "preparer",
      "Preparer of record (Tax, Books)",
      preparerNamed(env),
      false,
      `Engagement terms name ${env.PREPARER_OF_RECORD?.trim()}.`,
      "PREPARER_OF_RECORD is not set. Tax and Books show as opening soon and cannot start engagements.",
    ),
    check(
      "counsel",
      "Legal text reviewed by counsel",
      inputs.draftDocuments.length === 0,
      false,
      "No document is marked draft.",
      `Still marked draft: ${inputs.draftDocuments.join(", ")}.`,
    ),
    check(
      "pledge-recipient",
      "Labor Pledge recipient",
      has(env.PLEDGE_RECIPIENT),
      false,
      `Contributions go to ${env.PLEDGE_RECIPIENT?.trim()}.`,
      "PLEDGE_RECIPIENT is not set. The public page names no fund.",
    ),
    check(
      "ai",
      "AI drafting",
      has(env.ANTHROPIC_API_KEY),
      false,
      "ANTHROPIC_API_KEY is set.",
      "ANTHROPIC_API_KEY is not set. Drafts use deterministic fallbacks and route more work to the reviewer.",
    ),
  ];
}

/** Failed blocking checks. Empty means the deployment may open to the public. */
export const launchBlockers = (checks: LaunchCheck[]) => checks.filter((c) => c.blocking && !c.ok);
