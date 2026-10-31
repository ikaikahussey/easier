import { eq } from "drizzle-orm";
import { OrgVault, unwrapKey } from "../crypto";
import type { Principal, Tx } from "../db/client";
import { orgKeys } from "../db/schema";
import type { Llm } from "../ai/llm";
import { llmFromEnv } from "../ai/anthropic";
import type { NonprofitRegistry } from "../connectors/nonprofit-registry";
import { propublicaRegistry } from "../connectors/nonprofit-registry";
import type { Role } from "../workflow";

export interface Actor {
  id: string;
  email: string;
  role: Role;
  /** False for a self-registered account that has not yet followed an emailed link. */
  emailVerified?: boolean;
  /** True when this session began with an emailed link, which proves control of the address. */
  viaLink?: boolean;
}

export const isStaff = (a: Actor) => a.role === "reviewer" || a.role === "admin";
export const principal = (a: Actor): Principal => ({ userId: a.id, staff: isStaff(a) });

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
  }
}
export class ForbiddenError extends Error {}
export class ValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
  }
}

export interface ServiceDeps {
  llm?: Llm;
  registry?: NonprofitRegistry;
}

let deps: ServiceDeps | undefined;
export const configureServices = (d: ServiceDeps | undefined) => {
  deps = d;
};
export const getDeps = (): ServiceDeps => (deps ??= { llm: llmFromEnv(), registry: propublicaRegistry() });

/**
 * Load an organization's vault inside a tenant transaction. RLS returns the key only
 * to members or to staff assigned to one of the org's engagements; anyone else gets
 * NotFound and cannot decrypt anything for that organization.
 */
export async function vaultFor(tx: Tx, orgId: string): Promise<OrgVault> {
  const [row] = await tx.select().from(orgKeys).where(eq(orgKeys.orgId, orgId));
  if (!row) throw new NotFoundError("Organization not found");
  return new OrgVault(unwrapKey(row.wrappedKey, orgId), orgId);
}
