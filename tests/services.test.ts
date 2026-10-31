import { beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { withSystem, withTenant, type Db } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { createOrganization, destroyOrganizationKey, getOrganization, listOrganizations } from "@/core/services/organizations";
import {
  acceptConsents,
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
import {
  consumeLogin,
  createSessionToken,
  hasPassword,
  joinWaitlist,
  loginWithPassword,
  readSessionToken,
  requestLogin,
  requestVerification,
  setPassword,
  signUp,
} from "@/core/services/auth";
import { addReviewTime, pilotMetrics, recordInvoice, startReviewTimer, stopReviewTimer } from "@/core/services/operations";
import { getReviewerProfile, listReviewers, setCredentialVerified, submitCredential } from "@/core/services/reviewers";
import { OrgVault, unwrapKey } from "@/core/crypto";
import type { Form990Data } from "@/products/form-990";
import { csv, intake990 } from "./fixtures";
import { freshDb, makeUser } from "./helpers/db";

process.env.PREPARER_OF_RECORD = "Rita Reyes, EA";

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

const BOTH = ["engagement_letter", "irc_7216"];
/** Accept documents the way the form does: posting the version and hash of the text displayed. */
async function sign(who: Actor, eng: string, documents = BOTH, signer = { signerName: "Leilani Kahale", signerTitle: "Treasurer" }) {
  const shown = (await getEngagement(who, eng)).consents;
  for (const id of documents) {
    const c = shown.find((x) => x.id === id);
    await acceptConsents(who, eng, { document: id, version: c?.version ?? "v", sha256: c?.sha256 ?? "x", ...signer });
  }
}
const credential = { name: "Rita Reyes", credentialType: "EA", credentialNumber: "00123456", credentialJurisdiction: "IRS", ptin: "P01234567" };

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

  it("submit requires the client to accept the engagement letter and 7216 consent", async () => {
    await expect(transition(alice, engA, "submit")).rejects.toThrow(/Accept the engagement letter and the consent/);
    await expect(sign(rita, engA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(acceptConsents(rita, engA, { document: "irc_7216", version: "v", sha256: "x", signerName: "R", signerTitle: "T" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(acceptConsents(bob, engA, { document: "irc_7216", version: "v", sha256: "x", signerName: "B", signerTitle: "T" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(sign(alice, engA, ["engagement_letter"], { signerName: " ", signerTitle: "" })).rejects.toThrow(/full name/);
    await expect(sign(alice, engA, ["something_else"])).rejects.toThrow(/Unknown document/);
    // Text that changed after the page loaded is refused.
    await expect(
      acceptConsents(alice, engA, { document: "irc_7216", version: "2026-10-pilot-draft-1", sha256: "0".repeat(64), signerName: "L", signerTitle: "T" }),
    ).rejects.toThrow(/changed after you opened/);
    // No preparer configured: the consent cannot name one, so nothing can be accepted.
    delete process.env.PREPARER_OF_RECORD;
    await expect(sign(alice, engA, ["engagement_letter"])).rejects.toThrow(/no preparer of record/);
    process.env.PREPARER_OF_RECORD = "Rita Reyes, EA";
    await sign(alice, engA, ["engagement_letter"]);
    await expect(transition(alice, engA, "submit")).rejects.toThrow(/consent to use and disclose/);
    await sign(alice, engA, ["irc_7216"]);
    const d = await getEngagement(alice, engA);
    expect(d.consents.map((c) => [c.id, c.accepted?.signerName])).toEqual([
      ["engagement_letter", "Leilani Kahale"],
      ["irc_7216", "Leilani Kahale"],
    ]);
    const evt = d.events.find((e) => e.type === "consent_accepted")!.payload!;
    expect(evt).toMatchObject({ signerTitle: "Treasurer", version: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("an acceptance no longer counts once the text it hashed changes", async () => {
    process.env.PREPARER_OF_RECORD = "Someone Else, CPA";
    const d = await getEngagement(alice, engA);
    expect(d.consents.every((c) => !c.accepted)).toBe(true);
    expect(d.consents[0]!.paragraphs[0]).toMatch(/Someone Else, CPA/);
    process.env.PREPARER_OF_RECORD = "Rita Reyes, EA";
    expect((await getEngagement(alice, engA)).consents.every((c) => c.accepted)).toBe(true);
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

  it("only verified reviewers with an accepted credential may sign", async () => {
    await expect(submitCredential(alice, credential)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitCredential(rita, { ...credential, ptin: "12345678", credentialType: "Wizard" })).rejects.toThrow(
      /Choose a credential.*PTIN is P followed by 8 digits/,
    );
    await submitCredential(rita, credential);
    expect((await getReviewerProfile(rita)).verifiedAt).toBeNull();
    await expect(setCredentialVerified(rex, rita.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCredentialVerified(admin, rex.id, true)).rejects.toThrow(/not submitted/);
    await expect(setCredentialVerified(admin, admin.id, true)).rejects.toThrow(/Another admin/);
    const loaded = (await listReviewers(admin)).find((r) => r.id === rita.id)!;
    await expect(setCredentialVerified(admin, rita.id, true, "2020-01-01T00:00:00.000Z")).rejects.toThrow(/changed after you loaded/);
    await setCredentialVerified(admin, rita.id, true, loaded.submittedAt!.toISOString());
    expect((await getReviewerProfile(rita)).verifiedAt).toBeInstanceOf(Date);
    // Any change clears verification until an admin checks it again; resubmitting the same details does not.
    await submitCredential(rita, credential);
    expect((await getReviewerProfile(rita)).verifiedAt).toBeInstanceOf(Date);
    await submitCredential(rita, { ...credential, efin: "123456" });
    const changed = await getReviewerProfile(rita);
    expect(changed.verifiedAt).toBeNull();
    // An admin who loaded the page before the change cannot verify the new details.
    await expect(setCredentialVerified(admin, rita.id, true, loaded.submittedAt!.toISOString())).rejects.toThrow(/changed after you loaded/);
    await setCredentialVerified(admin, rita.id, true, changed.submittedAt!.toISOString());
    expect((await listReviewers(admin)).map((r) => r.email)).toContain("rita@easier.company");
    await expect(listReviewers(rita)).rejects.toBeInstanceOf(ForbiddenError);
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
    const signed = (await getEngagement(alice, engA)).events.find((e) => e.type === "status:approve")!.payload!;
    expect(signed.signer).toEqual({ name: "Rita Reyes", credential: "EA" });

    const d = await getEngagement(alice, engA);
    expect(d.draft!.version).toBe(2);
    const types = d.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["claimed", "staff_viewed", "review_saved", "status:approve", "status:deliver"]));
    expect(d.events.find((e) => e.type === "review_saved")!.payload).toEqual({ reclassified: ["6900"], editedText: ["program.0"] });
  });

  it("requires a note to request changes", async () => {
    await sign(bob, engB);
    await transition(bob, engB, "submit");
    await claim(rex, engB);
    await expect(transition(rex, engB, "approve")).rejects.toThrow(/credential has not been verified/);
    await expect(transition(rex, engB, "request_changes")).rejects.toThrow(/note/);
    expect(await transition(rex, engB, "request_changes", "Please upload the December statement")).toBe("changes_requested");
  });
});

describe("pilot operations", () => {
  it("claiming starts the review timer; pausing, manual time, and leaving review accumulate it", async () => {
    // engA: claimed while in review, so its timer started then and stopped at approval.
    const a = await getEngagement(rita, engA);
    expect(a.reviewTimerRunning).toBe(false);
    expect(a.events.map((e) => e.type)).toEqual(expect.arrayContaining(["timer_started"]));
    expect(a.events.find((e) => e.type === "status:approve")!.payload).toHaveProperty("timerSeconds");

    // engB went back to the client, which stopped rex's timer; it cannot run while the client has the work.
    expect((await getEngagement(rex, engB)).reviewTimerRunning).toBe(false);
    await expect(startReviewTimer(rex, engB)).rejects.toThrow(/client has this engagement/);
    await transition(bob, engB, "submit");
    await expect(startReviewTimer(rita, engB)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startReviewTimer(bob, engB)).rejects.toBeInstanceOf(ForbiddenError);
    await startReviewTimer(rex, engB);
    expect((await getEngagement(rex, engB)).reviewTimerRunning).toBe(true);
    // Backdate the running timer by 30 minutes, then pause.
    await withSystem((tx) =>
      tx.update(schema.engagements).set({ reviewStartedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(schema.engagements.id, engB)),
    );
    const seconds = await stopReviewTimer(rex, engB);
    expect(seconds).toBeGreaterThanOrEqual(1800);
    expect(seconds).toBeLessThan(1810);
    expect(await stopReviewTimer(rex, engB)).toBe(0);

    await expect(addReviewTime(rex, engB, 0, "x")).rejects.toThrow(/whole minutes/);
    await expect(addReviewTime(rex, engB, 15, " ")).rejects.toThrow(/Describe/);
    await addReviewTime(rex, engB, 45, "Keyed return into Tax990");
    const b = await getEngagement(rex, engB);
    expect(b.reviewSeconds).toBeGreaterThanOrEqual(1800 + 45 * 60);
    expect(b.events.find((e) => e.type === "time_added")!.payload).toEqual({ minutes: 45, note: "Keyed return into Tax990" });
  });

  it("a forgotten timer counts at most 4 hours", async () => {
    await startReviewTimer(rex, engB);
    await withSystem((tx) =>
      tx.update(schema.engagements).set({ reviewStartedAt: new Date(Date.now() - 20 * 3600_000) }).where(eq(schema.engagements.id, engB)),
    );
    expect(await stopReviewTimer(rex, engB)).toBe(4 * 3600);
  });

  it("reassignment stops the previous reviewer's timer and credits the time", async () => {
    await startReviewTimer(rex, engB);
    await withSystem((tx) =>
      tx.update(schema.engagements).set({ reviewStartedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.engagements.id, engB)),
    );
    const before = (await pilotMetrics(admin)).rows.find((r) => r.id === engB)!.reviewSeconds;
    await claim(admin, engB, rita.id);
    const after = (await pilotMetrics(admin)).rows.find((r) => r.id === engB)!;
    expect(after.timerRunning).toBe(false);
    expect(after.reviewSeconds).toBeGreaterThanOrEqual(before);
    expect(after.reviewSeconds).toBeLessThan(before + 5);
    // The signer must be the preparer named in the client's terms.
    await submitCredential(rex, { ...credential, name: "Rex Ito" });
    const rexProfile = await getReviewerProfile(rex);
    await setCredentialVerified(admin, rex.id, true, rexProfile.submittedAt!.toISOString());
    await claim(admin, engB, rex.id);
    await expect(transition(rex, engB, "approve")).rejects.toThrow(/name Rita Reyes, EA as preparer/);
  });

  it("records e-filing, then IRS acceptance or rejection", async () => {
    await expect(transition(rita, engA, "record_filing", undefined, { submissionId: "short" })).rejects.toThrow(/submission ID/);
    await expect(
      transition(rita, engA, "record_filing", undefined, { submissionId: "12345620263200000abc", date: "2999-01-01" }),
    ).rejects.toThrow(/future/);
    await expect(transition(alice, engA, "record_filing", undefined, { submissionId: "12345620263200000abc" })).rejects.toThrow(
      /Role "client"/,
    );
    expect(await transition(rita, engA, "record_filing", undefined, { submissionId: "12345620263200000abc", date: "2026-10-10" })).toBe(
      "filed",
    );
    await expect(transition(rita, engA, "record_rejection")).rejects.toThrow(/note/);
    await expect(transition(rita, engA, "record_acceptance", undefined, { date: "2026-10-09" })).rejects.toThrow(/before the filing/);
    expect(await transition(rita, engA, "record_rejection", "R0000-500-01: EIN mismatch", { date: "2026-10-11" })).toBe("rejected");
    expect((await getEngagement(alice, engA)).filing).toMatchObject({ result: "rejected", rejectionNote: "R0000-500-01: EIN mismatch" });
    expect(await transition(rita, engA, "record_filing", undefined, { submissionId: "12345620263210000def", date: "2026-10-12" })).toBe(
      "filed",
    );
    expect(await transition(rita, engA, "record_acceptance", undefined, { date: "2026-10-13" })).toBe("accepted");
    const d = await getEngagement(alice, engA);
    expect(d.filing).toEqual({ submissionId: "12345620263210000def", filedOn: "2026-10-12", acknowledgedOn: "2026-10-13", result: "accepted" });
    expect(d.actions).toEqual([]);
  });

  it("filing actions exist only for products filed with the IRS", async () => {
    const carol = await makeUser(db, "carol2@c.org");
    const orgC = (await createOrganization(carol, { name: "Org C2" })).id;
    const engC = await createEngagement(carol, { orgId: orgC, product: "books", period: "2026-09-30", intake: { basis: "cash" } });
    const d = await getEngagement(carol, engC);
    expect(d.consents.map((c) => c.id)).toEqual(["engagement_letter"]);
    expect(d.consents[0]!.paragraphs.join(" ")).not.toMatch(/8879-TE/);
    await expect(transition(admin, engC, "record_filing")).rejects.toThrow(); // not assigned, and not a filed product
  });

  it("admins record invoices and see pilot metrics", async () => {
    await expect(recordInvoice(rita, engA, { amount: "1950", issuedOn: "2026-11-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordInvoice(admin, engA, { amount: "abc", issuedOn: "11/01/2026" })).rejects.toThrow(/amount.*issue date/);
    await expect(recordInvoice(admin, engA, { amount: "1950", issuedOn: "2026-11-02", paidOn: "2026-11-01" })).rejects.toThrow(
      /before the issue/,
    );
    await recordInvoice(admin, engA, { amount: "$1,950.00", issuedOn: "2026-11-01", paidOn: "2026-11-05", reference: "INV-001" });
    await expect(pilotMetrics(rita)).rejects.toBeInstanceOf(ForbiddenError);
    const m = await pilotMetrics(admin);
    const row = m.rows.find((r) => r.id === engA)!;
    expect(row.invoice).toEqual({ amountCents: 195_000, issuedOn: "2026-11-01", paidOn: "2026-11-05", reference: "INV-001" });
    expect(row.submissionId).toBe("12345620263210000def");
    expect(m.accepted).toBe(1);
    expect(m.paidCents).toBe(195_000);
    expect(m.signed.find((s) => s.tier === "Form 990")!.count).toBe(1);
    // Metrics are queue metadata: admins see them without being assigned, and no client content.
    expect(Object.keys(row)).not.toContain("intake");
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

  it("signs in with a password once one is set, and keeps the emailed link as the fallback", async () => {
    expect(await hasPassword(alice.id)).toBe(false);
    expect(await loginWithPassword("alice@a.org", "correct horse battery")).toBeUndefined(); // none set yet
    await expect(setPassword(alice.id, "short")).rejects.toThrow(/at least 12/);
    await setPassword(alice.id, "correct horse battery");
    expect(await hasPassword(alice.id)).toBe(true);
    const stored = await withSystem((tx) => tx.select({ h: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, alice.id)));
    expect(stored[0]!.h).toMatch(/^scrypt\$/);
    expect(stored[0]!.h).not.toContain("correct horse");
    expect(await loginWithPassword(" Alice@A.org ", "correct horse battery")).toMatchObject({ id: alice.id, role: "client" });
    expect(await loginWithPassword("alice@a.org", "wrong password here")).toBeUndefined();
    expect(await loginWithPassword("nobody@a.org", "correct horse battery")).toBeUndefined();
    // Changing requires the current password; the emailed link still works regardless.
    await expect(setPassword(alice.id, "another long password", "nope")).rejects.toThrow(/Current password/);
    await setPassword(alice.id, "another long password", "correct horse battery");
    expect(await loginWithPassword("alice@a.org", "another long password")).toBeTruthy();
    process.env.SITE_ACCESS = "open";
    expect(await consumeLogin((await requestLogin("alice@a.org"))!)).toMatchObject({ id: alice.id });
  });

  it("registers an account with email and password, verified by the emailed link", async () => {
    delete process.env.SITE_ACCESS;
    process.env.ACCESS_EMAILS = "new.client@x.org";
    await expect(signUp("new.client@x.org", "short")).rejects.toThrow(/at least 12/);
    // No access: no account, generic result, waitlisted.
    expect(await signUp("uninvited@x.org", "a perfectly fine password")).toBeUndefined();
    expect(await loginWithPassword("uninvited@x.org", "a perfectly fine password")).toBeUndefined();
    const wl = await withSystem((tx) => tx.select().from(schema.waitlist).where(eq(schema.waitlist.email, "uninvited@x.org")));
    expect(wl).toHaveLength(1);
    // Invited: account created, signed in, unverified until the link is used.
    const reg = (await signUp(" New.Client@X.org ", "a perfectly fine password", "  Pat Client  "))!;
    expect(reg.actor).toMatchObject({ email: "new.client@x.org", role: "client", emailVerified: false });
    expect(await loginWithPassword("new.client@x.org", "a perfectly fine password")).toMatchObject({ id: reg.actor.id, emailVerified: false });
    const [row] = await withSystem((tx) => tx.select().from(schema.users).where(eq(schema.users.id, reg.actor.id)));
    expect(row!.name).toBe("Pat Client");
    expect(row!.emailVerifiedAt).toBeNull();
    // Duplicate registration: refused generically, existing password untouched.
    expect(await signUp("new.client@x.org", "another password entirely")).toBeUndefined();
    expect(await loginWithPassword("new.client@x.org", "another password entirely")).toBeUndefined();
    // The verification link signs in and marks the address verified.
    expect(await consumeLogin(reg.token)).toMatchObject({ id: reg.actor.id, emailVerified: true });
    expect(await requestVerification(reg.actor.id)).toBeUndefined(); // already verified
    // A staff email registering gets its configured role.
    process.env.REVIEWER_EMAILS = "signup.reviewer@easier.company";
    expect((await signUp("signup.reviewer@easier.company", "reviewer password here"))!.actor.role).toBe("reviewer");
  });

  it("lets a session that began with an emailed link reset the password without the current one", async () => {
    const dana = await makeUser(db, "dana@d.org");
    await setPassword(dana.id, "danas first password");
    await expect(setPassword(dana.id, "danas second password")).rejects.toThrow(/Current password/);
    await setPassword(dana.id, "danas second password", undefined, { viaLink: true });
    expect(await loginWithPassword("dana@d.org", "danas second password")).toBeTruthy();
  });

  it("locks password sign-in after repeated failures", async () => {
    await setPassword(bob.id, "bobs long password!");
    for (let i = 0; i < 8; i++) expect(await loginWithPassword("bob@b.org", "wrong attempt " + i)).toBeUndefined();
    await expect(loginWithPassword("bob@b.org", "bobs long password!")).rejects.toThrow(/Too many failed/);
  });

  it("app role cannot read password hashes", async () => {
    const err = await withTenant({ userId: alice.id, staff: true }, (tx) => tx.select({ h: schema.users.passwordHash }).from(schema.users)).catch((e: Error) => e);
    expect(String((err as Error & { cause?: unknown }).cause)).toMatch(/permission denied/);
  });

  it("rejects tampered or expired sessions", () => {
    const t = createSessionToken("user-1", 0);
    expect(readSessionToken(t, 1000)).toEqual({ uid: "user-1", viaLink: false });
    expect(readSessionToken(createSessionToken("user-1", 0, { viaLink: true }), 1000)).toEqual({ uid: "user-1", viaLink: true });
    expect(readSessionToken(t, 13 * 3600 * 1000)).toBeUndefined();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9e15 })).toString("base64url");
    expect(readSessionToken(`${forged}.${mac}`, 1000)).toBeUndefined();
    expect(readSessionToken(`${body}.x${mac}`, 1000)).toBeUndefined();
  });
});
