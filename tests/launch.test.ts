import { describe, expect, it } from "vitest";
import { launchBlockers, launchChecks, lineStatus, mailDelivers, publicBaseUrl, siteAccessOpen, type Env } from "@/core/launch";
import { siteDocuments, siteTerms } from "@/core/site-terms";
import { draftDocuments } from "@/launch";

const READY: Env = {
  DATABASE_URL: "postgres://example",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  SESSION_SECRET: "x".repeat(32),
  RESEND_API_KEY: "re_123",
  APP_URL: "https://easier.company",
  CONTACT_EMAIL: "hello@easier.company",
  ADMIN_EMAILS: "ada@easier.company",
};
const failed = (env: Env, openLines = ["part-120"]) =>
  launchBlockers(launchChecks(env, { openLines, draftDocuments: [] })).map((c) => c.id);

describe("launch readiness", () => {
  it("has no blockers when the deployment is fully configured and a line is open", () => {
    expect(failed(READY)).toEqual([]);
  });

  it("blocks on each missing piece", () => {
    expect(failed({})).toEqual(["database", "encryption-key", "session-secret", "mail", "base-url", "contact", "admin"]);
    expect(failed({ ...READY, DATA_ENCRYPTION_KEY: "c2hvcnQ=" })).toEqual(["encryption-key"]);
    expect(failed({ ...READY, SESSION_SECRET: "short" })).toEqual(["session-secret"]);
    expect(failed({ ...READY, APP_URL: "http://easier.company" })).toEqual(["base-url"]);
    expect(failed(READY, [])).toEqual(["open-line"]);
  });

  it("treats logged mail as undelivered, even with a key", () => {
    expect(mailDelivers(READY)).toBe(true);
    expect(mailDelivers({ ...READY, MAIL_TRANSPORT: "log" })).toBe(false);
    expect(failed({ ...READY, MAIL_TRANSPORT: "log" })).toEqual(["mail"]);
    expect(launchChecks({ ...READY, MAIL_TRANSPORT: "log" }).find((c) => c.id === "mail")!.detail).toMatch(/MAIL_TRANSPORT=log/);
  });

  it("derives the public address from the platform when APP_URL is unset", () => {
    expect(publicBaseUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "easier.company" })).toBe("https://easier.company");
    expect(publicBaseUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app" })).toBe("https://b.vercel.app");
    expect(publicBaseUrl({})).toBeUndefined();
  });

  it("reports open items without blocking on them", () => {
    const checks = launchChecks(READY, { openLines: ["part-120"], draftDocuments: ["Terms of service"] });
    const open = checks.filter((c) => !c.ok);
    expect(open.map((c) => c.id)).toEqual(["preparer", "counsel", "pledge-recipient", "ai"]);
    expect(open.every((c) => !c.blocking)).toBe(true);
    expect(checks.find((c) => c.id === "counsel")!.detail).toMatch(/Terms of service/);
  });

  it("opens only on the exact setting", () => {
    expect(siteAccessOpen({ SITE_ACCESS: "open" })).toBe(true);
    expect(siteAccessOpen({ SITE_ACCESS: "OPEN" })).toBe(false);
    expect(siteAccessOpen({})).toBe(false);
  });
});

describe("service lines", () => {
  it("keeps engagement products closed until a preparer is named", () => {
    expect(lineStatus({ slug: "form-990", needsPreparer: true }, {})).toMatchObject({ open: false, reason: expect.stringMatching(/Opening soon/) });
    expect(lineStatus({ slug: "form-990", needsPreparer: true }, { PREPARER_OF_RECORD: "  " }).open).toBe(false);
    expect(lineStatus({ slug: "form-990", needsPreparer: true }, { PREPARER_OF_RECORD: "Rita Reyes, EA" })).toEqual({ slug: "form-990", open: true, reason: "" });
  });

  it("follows a program's own switch", () => {
    expect(lineStatus({ slug: "part-120", enabled: false }, {}).open).toBe(false);
    expect(lineStatus({ slug: "part-120", enabled: true }, {}).open).toBe(true);
  });
});

describe("site terms", () => {
  it("hashes both documents together and changes when either changes", () => {
    const before = siteTerms();
    expect(before.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(before.version).toMatch(/^terms:\S+ privacy:\S+$/);
    process.env.CONTACT_EMAIL = "privacy@easier.company";
    const after = siteTerms();
    delete process.env.CONTACT_EMAIL;
    expect(after.hash).not.toBe(before.hash);
    expect(JSON.stringify(siteDocuments())).not.toContain("privacy@easier.company");
  });

  it("lists every document still awaiting counsel", () => {
    expect(draftDocuments()).toEqual(["Terms of service", "Privacy policy", "Engagement letter", expect.stringMatching(/7216|Consent/i), "Part 120 Compliance Desk terms"]);
  });
});
