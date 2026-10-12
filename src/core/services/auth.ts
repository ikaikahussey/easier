import { and, count, eq, gt, isNull } from "drizzle-orm";
import { randomToken, sha256, sign, verify } from "../crypto";
import { withSystem } from "../db/client";
import { loginTokens, users, waitlist } from "../db/schema";
import type { Role } from "../workflow";
import { ValidationError, type Actor } from "./context";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TOKENS_PER_HOUR = 5;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const emailList = (v: string | undefined) =>
  new Set((v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/** Staff roles come only from server configuration, never from user input. */
function configuredRole(email: string): Role | undefined {
  if (emailList(process.env.ADMIN_EMAILS).has(email)) return "admin";
  if (emailList(process.env.REVIEWER_EMAILS).has(email)) return "reviewer";
  return undefined;
}

/**
 * Before launch, sign-in is invite-only (SITE_ACCESS=invite, the default): staff, emails in
 * ACCESS_EMAILS, and existing users. Set SITE_ACCESS=open at launch.
 */
export const siteIsOpen = () => process.env.SITE_ACCESS === "open";

export type WaitlistKind = (typeof waitlist.$inferInsert)["kind"];

/** Adds an email to the launch waitlist. Repeat signups are ignored. */
export async function joinWaitlist(rawEmail: string, kind: WaitlistKind = "other"): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL.test(email)) throw new ValidationError(["Enter a valid email address"]);
  const k = kind === "nonprofit" || kind === "small_business" ? kind : "other";
  await withSystem((tx) => tx.insert(waitlist).values({ email, kind: k }).onConflictDoNothing());
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Issue a single-use sign-in token. Only its hash is stored. Returns undefined when the site
 * is invite-only and this email has no access; the email is added to the waitlist instead.
 */
export async function requestLogin(rawEmail: string): Promise<string | undefined> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL.test(email)) throw new ValidationError(["Enter a valid email address"]);
  const token = randomToken();
  return withSystem(async (tx) => {
    if (!siteIsOpen() && !configuredRole(email) && !emailList(process.env.ACCESS_EMAILS).has(email)) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (!existing) {
        await tx.insert(waitlist).values({ email }).onConflictDoNothing();
        return undefined;
      }
    }
    const [{ n }] = (await tx
      .select({ n: count() })
      .from(loginTokens)
      .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, new Date(Date.now() - 3600_000))))) as [{ n: number }];
    if (n >= MAX_TOKENS_PER_HOUR) throw new ValidationError(["Too many sign-in requests; try again later"]);
    await tx.insert(loginTokens).values({ tokenHash: sha256(token), email, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) });
    return token;
  });
}

export async function consumeLogin(token: string): Promise<Actor | undefined> {
  return withSystem(async (tx) => {
    const [row] = await tx
      .update(loginTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
      .returning();
    if (!row) return undefined;
    const role = configuredRole(row.email);
    const [existing] = await tx.select().from(users).where(eq(users.email, row.email));
    if (existing) {
      if (role && existing.role !== role) await tx.update(users).set({ role }).where(eq(users.id, existing.id));
      return { id: existing.id, email: existing.email, role: role ?? (existing.role as Role) };
    }
    const [created] = await tx.insert(users).values({ email: row.email, role: role ?? "client" }).returning();
    return { id: created!.id, email: created!.email, role: created!.role as Role };
  });
}

export async function getActor(userId: string): Promise<Actor | undefined> {
  return withSystem(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    return u ? { id: u.id, email: u.email, role: u.role as Role } : undefined;
  });
}

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) is required in production");
  return "easier-insecure-development-session-secret";
}

export function createSessionToken(userId: string, now = Date.now()): string {
  return sign(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS }), sessionSecret());
}

export function readSessionToken(token: string | undefined, now = Date.now()): string | undefined {
  if (!token) return undefined;
  const payload = verify(token, sessionSecret());
  if (!payload) return undefined;
  try {
    const { uid, exp } = JSON.parse(payload) as { uid: string; exp: number };
    return exp > now ? uid : undefined;
  } catch {
    return undefined;
  }
}

/** Sends the sign-in link through Resend when configured; otherwise logs it for local development. */
export async function sendLoginLink(email: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || process.env.MAIL_TRANSPORT === "log") {
    if (process.env.NODE_ENV === "production" && process.env.MAIL_TRANSPORT !== "log")
      throw new Error("RESEND_API_KEY is required in production (or MAIL_TRANSPORT=log for local testing)");
    console.info(`[easier] Sign-in link for ${email}: ${url}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "easier.company <no-reply@easier.company>",
      to: email,
      subject: "Your easier.company sign-in link",
      text: `Sign in to easier.company: ${url}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Email delivery failed (${res.status})`);
}
