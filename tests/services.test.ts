import { beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { withSystem, withTenant, type Db } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { createOrganization, destroyOrganizationKey, getOrganization, listOrganizations } from "@/core/services/organizations";
import {
  claim,
  createEngagement,
  getEngagement,
  listEngagements,
  saveReview,
  transition,
  updateIntake,
  uploadDocument,
} from "@/core/services/engagements";
import { ForbiddenError, NotFoundError, ValidationError, type Actor } from "@/core/services/context";
import { consumeLogin, createSessionToken, joinWaitlist, readSessionToken, requestLogin } from "@/core/services/auth";
import { OrgVault, unwrapKey } from "@/core/crypto";
import type { Form990Data } from "@/products/form-990";
import { csv, intake990 } from "./fixtures";
import { freshDb, makeUser } from "./helpers/db";

let db: Db;
let alice: Actor; // client, org A
let bob: Actor; // client, org B
let rita: Actor; // reviewer
let rex: Actor; // second reviewer
let admin: Actor;
let orgA: string;
let orgB: string;
let engA: string;
let engB: string;

beforeAll(async () => {
  db = await freshDb({
    lookup: async () => ({ profile: { city: "Honolulu", state: "HI" }, filings: [{ year: 2024, totalRevenue: 450_000_00 }] }),
  });
  alice = await makeUser(db, "alice@a.org");
  bob = await makeUser(db, "bob@b.org");
  rita = await makeUser(db, "rita@easier.company", "reviewer");
  rex = await makeUser(db, "rex@easier.company", "reviewer");
  admin = await makeUser(db, "admin@easier.company", "admin");

  orgA = (await createOrganization(alice, { name: "Org A", ein: "991234567" })).id;
  orgB = (await createOrganization(bob, { name: "Org B" })).id;
  engA = await createEngagement(alice, { orgId: orgA, product: "form-990", period: "2025-12-31", intake: intake990 });
  engB = await createEngagement(bob, { orgId: orgB, product: "form-990", period: "2025-12-31", intake: intake990 });
  await uploadDocument(alice, engA, { kind: "trial_balance", filename: "tb.csv", text: csv("tb-990.csv") });
  await uploadDocument(bob, engB, { kind: "trial_balance", filename: "tb.csv", text: csv("tb-ez.csv") });
});

describe("engagement lifecycle", () => {
  it("prefills the organization from public filings", async () => {
    const org = await getOrganization(alice, orgA);
    expect(org.ein).toBe("99-1234567");
    expect(org.profile.city).toBe("Honolulu");
    expect(org.publicFilings[0]!.year).toBe(2024);
  });

  it("validates intake and prevents duplicate engagements", async () => {
    await expect(
      createEngagement(alice, { orgId: orgA, product: "form-990", period: "2024-12-31", intake: { ...intake990, mission: "" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createEngagement(alice, { orgId: orgA, product: "form-990", period: "2025-12-31", intake: intake990 }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects unparseable uploads with a readable message", async () => {
    await expect(uploadDocument(alice, engA, { kind: "trial_balance", filename: "x.csv", text: "a,b\n1,2" })).rejects.toThrow(
      /account name/,
    );
  });

  it("lets the client revise answers before review, and no one else", async () => {
    const revised = { ...intake990, unusualGrants: 2500 };
    await expect(updateIntake(alice, engA, { ...revised, mission: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateIntake(bob, engA, revised)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateIntake(rita, engA, revised)).rejects.toBeInstanceOf(ForbiddenError);
    await updateIntake(alice, engA, revised);
    const d = await getEngagement(alice, engA);
    expect((d.intake as typeof revised).unusualGrants).toBe(2500);
    expect(d.events.map((e) => e.type)).toContain("intake_updated");
    await updateIntake(alice, engA, intake990);
  });

  it("submit builds an AI draft and moves to review", async () => {
    expect(await transition(alice, engA, "submit")).toBe("in_review");
    const d = await getEngagement(alice, engA);
    expect(d.draft!.version).toBe(1);
    expect((d.draft!.snapshot.data as Form990Data).formType).toBe("990");
    expect(d.errorCount).toBeGreaterThan(0);
    expect(d.quote.tier).toBe("Form 990");
    expect(d.quote.pledge!.hours).toBeGreaterThan(0);
    expect(d.quote.pledge!.contribution).toBe(Math.round(d.quote.pledge!.laborValue * 0.124));
    expect(d.dueDate).toBe("2026-05-15");
    // Prior-year public filing feeds the variance check.
    expect(d.draft!.snapshot.findings.map((f) => f.ruleId)).not.toContain("f990.prior_year_variance");
    await expect(updateIntake(alice, engA, intake990)).rejects.toThrow(/can no longer be changed/);
  });

  it("unclaimed reviewers see queue metadata only", async () => {
    const queue = await listEngagements(rita, { statuses: ["in_review"] });
    expect(queue.map((q) => q.id)).toEqual([engA]);
    const d = await getEngagement(rita, engA);
    expect(d.accessible).toBe(false);
    expect(d.intake).toBeUndefined();
    expect(d.draft).toBeUndefined();
    await expect(saveReview(rita, engA, { mappings: {}, text: {} })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("assigned reviewer edits, approval is gated on findings, and staff reads are audited", async () => {
    await claim(rita, engA);
    await expect(claim(rex, engA)).rejects.toThrow(/already assigned/);
    const view = await getEngagement(rita, engA);
    expect(view.accessible).toBe(true);
    expect(view.actions).toEqual(expect.arrayContaining(["approve", "request_changes"]));
    await expect(transition(rita, engA, "approve")).rejects.toThrow(/blocking/);

    const snap = await saveReview(rita, engA, { mappings: { "6900": "IX.13" }, text: { "program.0": "Reviewed text." } });
    expect(snap.findings.filter((f) => f.severity === "error")).toEqual([]);

    expect(await transition(rita, engA, "approve")).toBe("approved");
    expect(await transition(rita, engA, "deliver")).toBe("delivered");

    const d = await getEngagement(alice, engA);
    expect(d.draft!.version).toBe(2);
    const types = d.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["claimed", "staff_viewed", "review_saved", "status:approve", "status:deliver"]));
    expect(d.events.find((e) => e.type === "review_saved")!.payload).toEqual({ reclassified: ["6900"], editedText: ["program.0"] });
  });

  it("requires a note to request changes", async () => {
    await transition(bob, engB, "submit");
    await claim(rex, engB);
    await expect(transition(rex, engB, "request_changes")).rejects.toThrow(/note/);
    expect(await transition(rex, engB, "request_changes", "Please upload the December statement")).toBe("changes_requested");
  });
});

describe("tenant isolation", () => {
  it("clients cannot see or touch another client's organization", async () => {
    expect((await listOrganizations(bob)).map((o) => o.id)).toEqual([orgB]);
    await expect(getOrganization(bob, orgA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getEngagement(bob, engA)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listEngagements(bob)).map((e) => e.id)).toEqual([engB]);
    await expect(uploadDocument(bob, engA, { kind: "trial_balance", filename: "x.csv", text: csv("tb-ez.csv") })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createEngagement(bob, { orgId: orgA, product: "books", period: "2026-09-30", intake: { basis: "cash" } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(transition(bob, engA, "reopen")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("row-level security holds even for queries with no WHERE clause", async () => {
    const counts = await withTenant({ userId: bob.id, staff: false }, async (tx) => ({
      docs: await tx.select().from(schema.documents),
      drafts: await tx.select().from(schema.drafts),
      keys: await tx.select().from(schema.orgKeys),
      orgs: await tx.select().from(schema.organizations),
      events: await tx.select().from(schema.events),
    }));
    expect(new Set(counts.docs.map((r) => r.orgId))).toEqual(new Set([orgB]));
    expect(new Set(counts.drafts.map((r) => r.orgId))).toEqual(new Set([orgB]));
    expect(counts.keys.map((r) => r.orgId)).toEqual([orgB]);
    expect(counts.orgs.map((r) => r.id)).toEqual([orgB]);
    expect(new Set(counts.events.map((r) => r.orgId))).toEqual(new Set([orgB]));
  });

  it("a client cannot impersonate staff by setting the staff flag", async () => {
    const rows = await withTenant({ userId: bob.id, staff: true }, (tx) => tx.select().from(schema.engagements));
    expect(rows.map((r) => r.id)).toEqual([engB]);
  });

  it("reviewers read content only for engagements assigned to them", async () => {
    const rexView = await withTenant({ userId: rex.id, staff: true }, async (tx) => ({
      docs: await tx.select().from(schema.documents),
      keys: await tx.select().from(schema.orgKeys),
    }));
    expect(new Set(rexView.docs.map((r) => r.engagementId))).toEqual(new Set([engB]));
    expect(rexView.keys.map((k) => k.orgId)).toEqual([orgB]);
  });

  it("the restricted role cannot write outside policy or escalate", async () => {
    await expect(
      withTenant({ userId: bob.id, staff: false }, (tx) =>
        tx.update(schema.engagements).set({ status: "approved" }).where(eq(schema.engagements.id, engA)).returning(),
      ),
    ).resolves.toEqual([]);
    await expect(
      withTenant({ userId: bob.id, staff: false }, (tx) => tx.delete(schema.documents)),
    ).rejects.toThrow();
    await expect(
      withTenant({ userId: bob.id, staff: false }, (tx) => tx.execute(sql`create table escalate (x int)`)),
    ).rejects.toThrow();
  });

  it("composite keys stop child rows pointing across tenants", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.events).values({ orgId: orgB, engagementId: engA, type: "x" }),
      ),
    ).rejects.toThrow();
  });

  it("ciphertext is bound to its tenant and record", async () => {
    const [a, b] = await withSystem(async (tx) => {
      const keys = await tx.select().from(schema.orgKeys);
      const ea = await tx.select().from(schema.engagements).where(eq(schema.engagements.id, engA));
      return [keys, ea[0]!] as const;
    });
    const keyB = a.find((k) => k.orgId === orgB)!;
    const vaultB = new OrgVault(unwrapKey(keyB.wrappedKey, orgB), orgB);
    expect(() => vaultB.open(b.intakeEnc, `engagements:${engA}:intake`)).toThrow(/Decryption failed/);
    const keyA = a.find((k) => k.orgId === orgA)!;
    const vaultA = new OrgVault(unwrapKey(keyA.wrappedKey, orgA), orgA);
    expect(() => vaultA.open(b.intakeEnc, `engagements:${engB}:intake`)).toThrow(/Decryption failed/);
    expect(vaultA.open(b.intakeEnc, `engagements:${engA}:intake`)).toMatchObject({ mission: intake990.mission });
    // A wrapped key copied to another org id does not unwrap.
    expect(() => unwrapKey(keyA.wrappedKey, orgB)).toThrow();
  });

  it("destroying a client's key makes its data unreadable", async () => {
    await expect(destroyOrganizationKey(alice, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    const carol = await makeUser(db, "carol@c.org");
    const orgC = (await createOrganization(carol, { name: "Org C" })).id;
    const engC = await createEngagement(carol, { orgId: orgC, product: "books", period: "2026-09-30", intake: { basis: "cash" } });
    await destroyOrganizationKey(admin, orgC);
    await expect(getEngagement(carol, engC)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("authentication", () => {
  it("issues single-use, hashed sign-in tokens and assigns staff roles from config", async () => {
    process.env.REVIEWER_EMAILS = "new.reviewer@easier.company";
    const token = (await requestLogin("New.Reviewer@Easier.company "))!;
    expect(token).toBeTruthy();
    const stored = await withSystem((tx) => tx.select().from(schema.loginTokens));
    expect(stored.some((t) => t.tokenHash === token)).toBe(false);
    const actor = await consumeLogin(token);
    expect(actor).toMatchObject({ email: "new.reviewer@easier.company", role: "reviewer" });
    expect(await consumeLogin(token)).toBeUndefined();
    expect(await consumeLogin("nonsense")).toBeUndefined();
  });

  it("is invite-only before launch: unknown emails join the waitlist instead of getting a link", async () => {
    delete process.env.SITE_ACCESS;
    process.env.ACCESS_EMAILS = "invited@x.org";
    expect(await requestLogin("stranger@x.org")).toBeUndefined();
    expect(await requestLogin("invited@x.org")).toBeTruthy();
    expect(await requestLogin("alice@a.org")).toBeTruthy(); // existing user
    const rows = await withSystem((tx) => tx.select().from(schema.waitlist));
    expect(rows.map((r) => r.email)).toEqual(["stranger@x.org"]);
    const tokens = await withSystem((tx) => tx.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, "stranger@x.org")));
    expect(tokens).toHaveLength(0);
    process.env.SITE_ACCESS = "open";
    expect(await requestLogin("stranger@x.org")).toBeTruthy();
  });

  it("records waitlist signups once, with a valid kind", async () => {
    await joinWaitlist(" Owner@Shop.com ", "small_business");
    await joinWaitlist("owner@shop.com", "nonprofit");
    await joinWaitlist("odd@x.org", "bogus" as never);
    await expect(joinWaitlist("not-an-email")).rejects.toBeInstanceOf(ValidationError);
    const rows = await withSystem((tx) => tx.select().from(schema.waitlist).where(sql`email in ('owner@shop.com','odd@x.org')`));
    expect(Object.fromEntries(rows.map((r) => [r.email, r.kind]))).toEqual({ "owner@shop.com": "small_business", "odd@x.org": "other" });
  });

  it("app role cannot read the waitlist", async () => {
    const err = await withTenant({ userId: alice.id, staff: true }, (tx) => tx.select().from(schema.waitlist)).catch((e: Error) => e);
    expect(String((err as Error & { cause?: unknown }).cause)).toMatch(/permission denied/);
  });

  it("rate-limits sign-in requests", async () => {
    for (let i = 0; i < 5; i++) await requestLogin("spam@x.org");
    await expect(requestLogin("spam@x.org")).rejects.toThrow(/Too many/);
  });

  it("rejects tampered or expired sessions", () => {
    const t = createSessionToken("user-1", 0);
    expect(readSessionToken(t, 1000)).toBe("user-1");
    expect(readSessionToken(t, 13 * 3600 * 1000)).toBeUndefined();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9e15 })).toString("base64url");
    expect(readSessionToken(`${forged}.${mac}`, 1000)).toBeUndefined();
    expect(readSessionToken(`${body}.x${mac}`, 1000)).toBeUndefined();
  });
});
