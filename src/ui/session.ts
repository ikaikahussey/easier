import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, getActor, readSessionToken, SESSION_TTL_MS } from "@/core/services/auth";
import { isStaff, type Actor } from "@/core/services/context";

const COOKIE = "ec_session";

export async function currentActor(): Promise<Actor | undefined> {
  const uid = readSessionToken((await cookies()).get(COOKIE)?.value);
  return uid ? getActor(uid) : undefined;
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

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, createSessionToken(userId), {
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
