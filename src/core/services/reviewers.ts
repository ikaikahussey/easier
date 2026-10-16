import { asc, eq, inArray } from "drizzle-orm";
import { withSystem } from "../db/client";
import { users } from "../db/schema";
import { PRODUCTS } from "@/products";
import { ForbiddenError, isStaff, NotFoundError, ValidationError, type Actor } from "./context";

/**
 * Reviewer credentials. A reviewer records their credential, PTIN, and EFIN; an admin
 * checks them against the issuing body (IRS enrolled agent and PTIN directories, the
 * state board of accountancy) and marks them verified. Only verified reviewers whose
 * credential a product accepts can approve its work. Changing any detail clears the
 * verification.
 */

/** Every credential some product accepts for sign-off. */
export const CREDENTIAL_TYPES = [...new Set(PRODUCTS.flatMap((p) => p.reviewerCredentials))];

export interface ReviewerProfile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  credentialType: string | null;
  credentialNumber: string | null;
  credentialJurisdiction: string | null;
  ptin: string | null;
  efin: string | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
}

const PROFILE = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  credentialType: users.credentialType,
  credentialNumber: users.credentialNumber,
  credentialJurisdiction: users.credentialJurisdiction,
  ptin: users.ptin,
  efin: users.efin,
  submittedAt: users.credentialSubmittedAt,
  verifiedAt: users.credentialVerifiedAt,
};

export async function getReviewerProfile(actor: Actor): Promise<ReviewerProfile> {
  if (!isStaff(actor)) throw new ForbiddenError("Only staff have reviewer profiles");
  return withSystem(async (tx) => {
    const [p] = await tx.select(PROFILE).from(users).where(eq(users.id, actor.id));
    if (!p) throw new NotFoundError();
    return p;
  });
}

export interface CredentialInput {
  name: string;
  credentialType: string;
  credentialNumber: string;
  credentialJurisdiction: string;
  ptin: string;
  efin?: string;
}

/** A reviewer records or updates their own credential. Verification is cleared until an admin checks it again. */
export async function submitCredential(actor: Actor, input: CredentialInput): Promise<void> {
  if (!isStaff(actor)) throw new ForbiddenError("Only staff record credentials");
  const v = {
    name: input.name.trim().slice(0, 120),
    credentialType: input.credentialType.trim(),
    credentialNumber: input.credentialNumber.trim().slice(0, 40),
    credentialJurisdiction: input.credentialJurisdiction.trim().toUpperCase().slice(0, 20),
    ptin: input.ptin.trim().toUpperCase(),
    efin: input.efin?.trim() || null,
  };
  const issues = [
    !v.name && "Enter your name as it appears on the return",
    !CREDENTIAL_TYPES.includes(v.credentialType) && `Choose a credential: ${CREDENTIAL_TYPES.join(", ")}`,
    !v.credentialNumber && "Enter your license or enrollment number",
    !v.credentialJurisdiction && "Enter the issuing state, or IRS for an enrolled agent",
    !/^P\d{8}$/.test(v.ptin) && "A PTIN is P followed by 8 digits",
    v.efin && !/^\d{6}$/.test(v.efin) && "An EFIN is 6 digits",
  ].filter(Boolean) as string[];
  if (issues.length) throw new ValidationError(issues);
  await withSystem(async (tx) => {
    const [current] = await tx.select(PROFILE).from(users).where(eq(users.id, actor.id));
    if (!current) throw new NotFoundError();
    const unchanged =
      current.name === v.name &&
      current.credentialType === v.credentialType &&
      current.credentialNumber === v.credentialNumber &&
      current.credentialJurisdiction === v.credentialJurisdiction &&
      current.ptin === v.ptin &&
      current.efin === v.efin;
    if (unchanged) return;
    await tx
      .update(users)
      .set({ ...v, credentialSubmittedAt: new Date(), credentialVerifiedAt: null, credentialVerifiedBy: null })
      .where(eq(users.id, actor.id));
  });
}

export async function listReviewers(actor: Actor): Promise<ReviewerProfile[]> {
  if (actor.role !== "admin") throw new ForbiddenError("Only admins manage reviewers");
  return withSystem((tx) =>
    tx.select(PROFILE).from(users).where(inArray(users.role, ["reviewer", "admin"])).orderBy(asc(users.email)),
  );
}

/** An admin confirms a reviewer's credential after checking it with the issuing body. */
export async function setCredentialVerified(actor: Actor, reviewerId: string, verified: boolean): Promise<void> {
  if (actor.role !== "admin") throw new ForbiddenError("Only admins verify credentials");
  if (verified && reviewerId === actor.id) throw new ForbiddenError("Another admin must verify your credential");
  await withSystem(async (tx) => {
    const [r] = await tx.select(PROFILE).from(users).where(eq(users.id, reviewerId));
    if (!r || !isStaff({ id: r.id, email: r.email, role: r.role as Actor["role"] })) throw new NotFoundError("Reviewer not found");
    if (verified && (!r.credentialType || !r.ptin)) throw new ValidationError(["The reviewer has not submitted a credential"]);
    await tx
      .update(users)
      .set(verified ? { credentialVerifiedAt: new Date(), credentialVerifiedBy: actor.id } : { credentialVerifiedAt: null, credentialVerifiedBy: null })
      .where(eq(users.id, reviewerId));
  });
}
