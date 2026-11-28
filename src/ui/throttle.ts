import "server-only";
import { headers } from "next/headers";
import { throttle, throttleKey } from "@/core/services/auth";

export const HOUR = 3600_000;

/**
 * Limits a public form per network address. The platform sets the forwarding header; without
 * one (local development) there is nothing to key on and no limit applies.
 */
export async function limit(purpose: string, max: number, windowMs: number): Promise<void> {
  const h = await headers();
  const address = (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim();
  if (address) await throttle(throttleKey(purpose, address), max, windowMs);
}
