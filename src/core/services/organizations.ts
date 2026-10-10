import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { newDataKey, wrapKey } from "../crypto";
import { withSystem, withTenant } from "../db/client";
import { memberships, organizations, orgKeys } from "../db/schema";
import { normalizeEin } from "../connectors/nonprofit-registry";
import type { OrgProfile, PriorYear } from "../product";
import { ForbiddenError, getDeps, isStaff, NotFoundError, principal, ValidationError, type Actor } from "./context";

export interface OrganizationView {
  id: string;
  name: string;
  ein: string | null;
  profile: OrgProfile;
  publicFilings: PriorYear[];
}

const view = (r: typeof organizations.$inferSelect): OrganizationView => ({
  id: r.id,
  name: r.name,
  ein: r.ein,
  profile: { ...(r.profile as OrgProfile), name: r.name, ein: r.ein ?? undefined },
  publicFilings: r.publicFilings as PriorYear[],
});

/**
 * Provision a tenant: organization row, its own wrapped data key, and the creator's
 * membership. Runs privileged because the creator is not yet a member.
 */
export async function createOrganization(
  actor: Actor,
  input: { name: string; ein?: string; website?: string },
): Promise<OrganizationView> {
  if (isStaff(actor)) throw new ForbiddenError("Staff accounts cannot own client organizations");
  const name = input.name.trim();
  if (!name) throw new ValidationError(["Organization name is required"]);
  let ein: string | undefined;
  if (input.ein?.trim()) {
    ein = normalizeEin(input.ein);
    if (!ein) throw new ValidationError(["EIN must have 9 digits"]);
  }

  const found = ein ? await getDeps().registry?.lookup(ein) : undefined;
  const id = randomUUID();
  const profile: OrgProfile = {
    name,
    ein,
    city: found?.profile.city,
    state: found?.profile.state,
    subsection: found?.profile.subsection,
    website: input.website?.trim() || undefined,
  };

  await withSystem(async (tx) => {
    await tx.insert(organizations).values({ id, name, ein, profile, publicFilings: found?.filings ?? [] });
    await tx.insert(orgKeys).values({ orgId: id, wrappedKey: wrapKey(newDataKey(), id) });
    await tx.insert(memberships).values({ orgId: id, userId: actor.id, role: "owner" });
  });
  return getOrganization(actor, id);
}

export async function listOrganizations(actor: Actor): Promise<OrganizationView[]> {
  return withTenant(principal(actor), async (tx) => {
    const rows = await tx
      .select({ org: organizations })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.orgId, organizations.id))
      .where(eq(memberships.userId, actor.id))
      .orderBy(asc(organizations.name));
    return rows.map((r) => view(r.org));
  });
}

export async function getOrganization(actor: Actor, id: string): Promise<OrganizationView> {
  return withTenant(principal(actor), async (tx) => {
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
    if (!row) throw new NotFoundError("Organization not found");
    return view(row);
  });
}

/** Crypto-shredding: destroy the org's data key so its sealed content can never be read again. */
export async function destroyOrganizationKey(actor: Actor, orgId: string): Promise<void> {
  if (actor.role !== "admin") throw new ForbiddenError("Only administrators can destroy client data keys");
  await withSystem(async (tx) => {
    const deleted = await tx.delete(orgKeys).where(eq(orgKeys.orgId, orgId)).returning();
    if (!deleted.length) throw new NotFoundError("Organization key not found");
  });
}
