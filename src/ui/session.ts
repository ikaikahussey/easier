import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, getActor, readSessionToken, SESSION_TTL_MS } from "@/core/services/auth";
import { isStaff, type Actor } from "@/core/services/context";

const COOKIE = "ec_session";

export async function currentActor(): Promise<Actor | undefined> {
  const session = readSessionToken((await cookies()).get(COOKIE)?.value);
  if (!session) return undefined;
  const actor = await getActor(session.uid);
  return actor ? { ...actor, viaLink: session.viaLink } : undefined;
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect("/login");
  return a;
}

export async function requireStaff(): Promise<Actor> {
  const a = await requireActor();
  if (!isStaff(a)) redirect("/app");
  return a;
}

export async function requireAdmin(): Promise<Actor> {
  const a = await requireActor();
  if (a.role !== "admin") redirect(isStaff(a) ? "/review" : "/app");
  return a;
}

export async function startSession(userId: string, opts: { viaLink?: boolean } = {}) {
  (await cookies()).set(COOKIE, createSessionToken(userId, Date.now(), opts), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}
