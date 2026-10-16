/**
 * End-to-end test against a production build, driving the real HTML forms without
 * JavaScript (server actions degrade to plain multipart POSTs). Exercises sign-in,
 * intake, upload, AI draft, reviewer claim/reclassify/approve, and tenant isolation.
 *
 *   npm run build && npm run e2e
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { parse } from "node-html-parser";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const root = path.resolve(import.meta.dirname, "..");
const dbDir = mkdtempSync(path.join(tmpdir(), "easier-e2e-"));
let log = "";

const server = spawn(path.join(root, "node_modules/.bin/next"), ["start", "-p", String(PORT)], {
  cwd: root,
  detached: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PGLITE_DIR: dbDir,
    DATABASE_URL: "",
    ANTHROPIC_API_KEY: "",
    MAIL_TRANSPORT: "log",
    APP_URL: BASE,
    REVIEWER_EMAILS: "rita@easier.company",
    ADMIN_EMAILS: "ada@easier.company",
    PREPARER_OF_RECORD: "Rita Reyes, EA",
    ACCESS_EMAILS: "alice@a.org,bob@b.org",
    SITE_ACCESS: "",
    SESSION_SECRET: "e2e-session-secret-0123456789abcdefghij",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  },
});
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Browser {
  cookie = "";
  async request(url, init = {}) {
    const res = await fetch(new URL(url, BASE), {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: this.cookie, origin: BASE },
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const [pair] = set.split(";");
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }
  /** GET following redirects; returns final URL, status, and parsed HTML. */
  async get(url) {
    let res = await this.request(url);
    let current = new URL(url, BASE).toString();
    for (let i = 0; i < 5 && res.status >= 300 && res.status < 400; i++) {
      current = new URL(res.headers.get("location"), current).toString();
      res = await this.request(current);
    }
    const html = await res.text();
    return { url: current, status: res.status, html, doc: parse(html), headers: res.headers };
  }
  /** Fill and submit a form on a page, like a browser with JavaScript disabled. */
  async submit(page, match, values = {}, files = {}) {
    const form = page.doc.querySelectorAll("form").find(match);
    assert.ok(form, `form not found on ${page.url}`);
    const fd = new FormData();
    const seen = new Set();
    for (const el of form.querySelectorAll("input, select, textarea")) {
      const name = el.getAttribute("name");
      if (!name || seen.has(name)) continue;
      const type = el.getAttribute("type");
      if (type === "file") continue;
      if (type === "radio" || type === "checkbox") {
        if (name in values) {
          if (!seen.has(name) && values[name] !== false) fd.append(name, values[name] === true ? "on" : values[name]);
          seen.add(name);
        } else if (el.hasAttribute("checked")) {
          fd.append(name, el.getAttribute("value") ?? "on");
          seen.add(name);
        }
        continue;
      }
      seen.add(name);
      let v = values[name];
      if (v === undefined) {
        if (el.tagName === "SELECT") v = el.querySelector("option[selected]")?.getAttribute("value") ?? "";
        else if (el.tagName === "TEXTAREA") v = el.text;
        else v = el.getAttribute("value") ?? "";
      }
      fd.append(name, String(v));
    }
    for (const [k, v] of Object.entries(values)) if (!seen.has(k) && v !== false) fd.append(k, String(v));
    for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.content], { type: "text/csv" }), f.name);
    const res = await this.request(page.url, { method: "POST", body: fd });
    const loc = res.headers.get("location");
    if (loc) return this.get(new URL(loc, page.url).toString());
    const html = await res.text();
    return { url: page.url, status: res.status, html, doc: parse(html), headers: res.headers };
  }
}

async function signIn(email) {
  const b = new Browser();
  const login = await b.get("/login");
  const before = log.length;
  const sent = await b.submit(login, (f) => !!f.querySelector("input[name=email]"), { email });
  assert.match(sent.html, /sign-in link is on its way/);
  await sleep(200);
  const link = log.slice(before).match(/Sign-in link for \S+: (\S+)/)?.[1];
  assert.ok(link, "sign-in link was not logged");
  const verify = await b.get(link);
  const after = await b.submit(verify, (f) => !!f.querySelector("input[name=token]"));
  assert.ok(b.cookie.startsWith("ec_session="), "no session cookie");
  return { b, landing: after };
}

const fixture = (n) => readFileSync(path.join(root, "tests/fixtures", n), "utf8");
const text = (page) => page.doc.text.replace(/\s+/g, " ");

async function main() {
  for (let i = 0; i < 60 && !log.includes("Ready"); i++) await sleep(500);
  assert.ok(log.includes("Ready"), `server did not start:\n${log}`);

  // Public teaser: headline and waitlist only; everything else needs a sign-in.
  const anon = new Browser();
  const home = await anon.get("/");
  assert.equal(home.status, 200);
  assert.match(text(home), /Nonprofit and small business chores,\s*made easier\./);
  assert.match(text(home), /Join the waitlist/);
  for (const area of ["Taxes", "Books", "Audit readiness", "Securities", "Documents", "Fundraising research"])
    assert.match(text(home), new RegExp(area));
  // Lines that need a licensing structure we do not have are not advertised.
  assert.doesNotMatch(text(home), /Annual nonprofit audits|capacity studies|legal paperwork|we pay Social Security/);
  assert.match(home.html, /href="#waitlist"/);
  assert.ok(home.doc.querySelector("#waitlist"), "waitlist anchor target missing");
  assert.doesNotMatch(text(home), /Labor Pledge|\$23\.08|Form 990 preparation|\$1,950/);
  assert.doesNotMatch(home.html, /href="\/labor-pledge"/);
  // Every control-looking element must do something: no decorative window buttons or status text.
  assert.doesNotMatch(home.html, /titlebar-buttons|>Ready</);
  for (const el of home.doc.querySelectorAll(".btn")) assert.ok(el.getAttribute("href") || el.tagName === "BUTTON", "inert .btn");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  for (const p of ["/labor-pledge", "/app", "/review"]) assert.match((await anon.get(p)).url, /\/login$/, `${p} is not gated`);

  const joined = await anon.submit(home, (f) => !!f.querySelector("select[name=kind]"), { email: "Owner@Shop.com", kind: "small_business" });
  assert.match(text(joined), /You're on the list/);
  const badJoin = await anon.submit(home, (f) => !!f.querySelector("select[name=kind]"), { email: "nope", kind: "nonprofit" });
  assert.match(text(badJoin), /Enter a valid email address/);

  // Uninvited sign-in: same message, no link issued.
  const stranger = new Browser();
  const before = log.length;
  const strangerSent = await stranger.submit(await stranger.get("/login"), (f) => !!f.querySelector("input[name=email]"), { email: "stranger@x.org" });
  assert.match(strangerSent.html, /sign-in link is on its way/);
  await sleep(200);
  assert.doesNotMatch(log.slice(before), /Sign-in link for stranger@x\.org/);

  // Client A: organization, intake, upload, submit
  const { b: alice, landing } = await signIn("alice@a.org");
  assert.match(landing.url, /\/app$/);
  const full = await alice.get("/");
  assert.match(text(full), /The Labor Pledge/);
  assert.match(text(full), /hours × \$23\.08 × 12\.4% = \$\d+\.\d\d/);
  assert.match(full.html, /href="\/labor-pledge"/);
  const pledgePage = await alice.get("/labor-pledge");
  assert.equal(pledgePage.status, 200);
  assert.match(text(pledgePage), /Human hours × \$23\.08 × 12\.4% = contribution/);
  assert.match(text(pledgePage), /Monthly close/);
  assert.match(text(pledgePage), /17\.85 hours × \$23\.08 = \$411\.98 of labor × 12\.4% = \$51\.09 contributed/);
  let page = await alice.submit(landing, (f) => !!f.querySelector("input[name=website]"), { name: "Kōkua Learning Center" });
  const start = page.doc.querySelectorAll("a").find((a) => /product=form-990/.test(a.getAttribute("href") ?? ""));
  assert.ok(start, "start link missing");
  const intakePage = await alice.get(start.getAttribute("href"));

  const yes = (k) => [k, "yes"];
  const no = (k) => [k, "no"];
  const intake = Object.fromEntries([
    ["period", "2025-12-31"],
    ["subsection", "501c3"],
    no("privateFoundation"),
    ["mission", "Provide after-school learning and college access for youth."],
    ["programs.0.name", "After-school learning"],
    ["programs.0.description", "Daily tutoring for grades 3-8."],
    ["programs.0.beneficiaries", "220 students"],
    ["programs.0.share", "70"],
    ["programs.1.name", "College access"],
    ["programs.1.description", "Advising and scholarships."],
    ["programs.1.share", "30"],
    ["officers.0.name", "Leilani Kahale"],
    ["officers.0.title", "Executive Director"],
    ["officers.0.position", "officer"],
    ["officers.0.hours", "40"],
    ["officers.0.compensation", "95000"],
    ["officers.1.name", "Sam Ortiz"],
    ["officers.1.title", "Board Chair"],
    ["officers.1.position", "director"],
    ["officers.1.hours", "2"],
    ["officers.1.compensation", "0"],
    ["employees", "7"],
    no("unrelatedCompensation"),
    ["street", "1234 Kalihi St"], ["city", "Honolulu"], ["state", "HI"], ["zip", "96819"], ["phone", "808-555-0100"],
    ["principalOfficer", "Leilani Kahale"], ["yearFormed", "2012"], ["domicileState", "HI"],
    ["orgForm", "corporation"], ["accountingMethod", "accrual"],
    ["votingMembers", "1"],
    ["independentMembers", "1"],
    no("familyRelationships"), yes("minutesKept"), yes("conflictPolicy"), yes("whistleblowerPolicy"),
    no("documentRetentionPolicy"), yes("compensationProcess"),
    ["formReviewProcess", "The Finance Committee reviews the draft before filing."],
    ["documentsAvailability", "own_website"],
    yes("contributorOver5000"), no("lobbying"), no("politicalCampaign"), no("auditedFinancials"),
    no("noncashOver25000"), no("highComp"), no("interestedTransactions"), no("relatedOrganizations"),
    no("foreignActivities"),
    ["programPct", "75"], ["managementPct", "15"], ["fundraisingPct", "10"],
  ]);

  // Validation error keeps submitted values
  const bad = await alice.submit(intakePage, (f) => !!f.querySelector("input[name=mission]") || !!f.querySelector("textarea[name=mission]"), {
    ...intake,
    programPct: "abc",
  });
  assert.match(text(bad), /Program \(%\)/, "validation message missing");
  assert.equal(bad.doc.querySelector("textarea[name=mission]")?.text, intake.mission, "intake values were lost");

  page = await alice.submit(intakePage, (f) => !!f.querySelector("textarea[name=mission]"), intake);
  const engagementUrl = page.url;
  assert.match(engagementUrl, /\/engagements\/[0-9a-f-]{36}$/, `unexpected ${engagementUrl}: ${text(page).slice(0, 300)}`);
  assert.match(text(page), /Awaiting documents/);

  // Client revises answers to add schedule detail; saved answers come back prefilled.
  const editLink = page.doc.querySelectorAll("a").find((a) => /\/intake$/.test(a.getAttribute("href") ?? ""));
  assert.ok(editLink, "edit answers link missing");
  const editPage = await alice.get(editLink.getAttribute("href"));
  assert.equal(editPage.doc.querySelector("input[name='officers.0.name']")?.getAttribute("value"), "Leilani Kahale", "saved answers not prefilled");
  assert.ok(editPage.doc.querySelector("details summary"), "schedule sections are not collapsible");
  page = await alice.submit(editPage, (f) => !!f.querySelector("input[name=engagementId]") && !!f.querySelector("textarea[name=mission]"), {
    charityStatus: "publicly_supported",
    exemptSinceYear: "2012",
    "supportHistory.0.year": "2021", "supportHistory.0.contributions": "300000", "supportHistory.0.relatedReceipts": "40000", "supportHistory.0.investmentIncome": "1000",
    "supportHistory.1.year": "2022", "supportHistory.1.contributions": "340000", "supportHistory.1.relatedReceipts": "40000", "supportHistory.1.investmentIncome": "1000",
    "supportHistory.2.year": "2023", "supportHistory.2.contributions": "380000", "supportHistory.2.relatedReceipts": "40000", "supportHistory.2.investmentIncome": "1000",
    "supportHistory.3.year": "2024", "supportHistory.3.contributions": "410000", "supportHistory.3.relatedReceipts": "40000", "supportHistory.3.investmentIncome": "1000",
    "contributors.0.name": "Ana Lee", "contributors.0.address": "1 Pali Hwy, Honolulu, HI", "contributors.0.kind": "individual", "contributors.0.amount": "10000", "contributors.0.fiveYearTotal": "60000",
    "contributors.1.name": "Hale Foundation", "contributors.1.address": "2 Bishop St, Honolulu, HI", "contributors.1.kind": "foundation", "contributors.1.amount": "150000", "contributors.1.fiveYearTotal": "500000",
    "events.0.name": "Annual Gala", "events.0.grossReceipts": "30000", "events.0.contributions": "18000", "events.0.food": "6000", "events.0.rent": "3000",
    grantRecords: "yes",
    grantMonitoring: "Scholarships are paid directly to colleges after enrollment is verified.",
    // Parts V, VI, XII
    forms1096Count: "0", backupWithholding: "yes", employmentReturnsFiled: "yes",
    managementCompany: "no", governingDocChanges: "no", assetDiversion: "no", hasMembers: "no", membersElect: "no", membersApprove: "no",
    committeeMinutes: "yes", unreachableOfficer: "no", localChapters: "no", boardCopyBeforeFiling: "yes", annualDisclosure: "yes",
    otherOfficerCompProcess: "yes", jointVenture: "no", statesFiled: "HI", booksCustodianName: "Mei Tanaka",
    compiledOrReviewed: "no", singleAuditRequired: "no",
    "grantsToIndividuals.0.type": "College scholarships", "grantsToIndividuals.0.recipients": "12", "grantsToIndividuals.0.cash": "12000",
  });
  assert.equal(page.url, engagementUrl, `answers were not saved: ${text(page).slice(0, 300)}`);
  assert.match(text(page), /intake updated/);

  page = await alice.submit(page, (f) => !!f.querySelector("input[type=file]"), {}, { file: { name: "tb.csv", content: fixture("tb-990.csv") } });
  assert.match(text(page), /Uploaded: tb\.csv/);

  // Engagement terms come first: submit is disabled, and forcing it is refused.
  const submitForm = (f) => f.querySelector("input[name=action]")?.getAttribute("value") === "submit";
  assert.ok(page.doc.querySelectorAll("form").find(submitForm).querySelector("button[disabled]"), "submit enabled before terms");
  assert.match(text(page), /This letter confirms the terms under which Rita Reyes, EA/);
  assert.match(text(page), /Anthropic, PBC/);
  page = await alice.submit(page, submitForm);
  assert.match(text(page), /Accept the engagement letter and the consent/);
  const termsForm = (f) => !!f.querySelector("input[name=signerName]");
  page = await alice.submit(page, termsForm, { "accept:engagement_letter": true, "accept:irc_7216": true, signerName: "", signerTitle: "" });
  assert.match(text(page), /Type your full name/);
  page = await alice.submit(page, termsForm, {
    "accept:engagement_letter": true,
    "accept:irc_7216": true,
    signerName: "Leilani Kahale",
    signerTitle: "Executive Director",
  });
  assert.match(text(page), /Engagement letter: accepted by Leilani Kahale, Executive Director/);
  assert.match(text(page), /consent accepted/);
  page = await alice.submit(page, submitForm);
  assert.match(text(page), /In review/);
  assert.match(text(page), /could not be classified/);
  assert.match(text(page), /Statement of Functional Expenses/);
  assert.match(text(page), /Schedule A Part II, Section C/);
  assert.match(text(page), /73\.70%/);
  assert.match(text(page), /Schedule G Part II: fundraising events/);
  assert.match(text(page), /Labor Pledge: this work would take a person about [\d.]+ hours\. At a living wage of \$23\.08 an hour, that is \$[\d,.]+ of labor\. From this fee,\s*easier.company contributes \$[\d.]+ \(12\.4%\)/);
  const engagementId = engagementUrl.split("/").pop();

  // Client B cannot reach client A's engagement
  const { b: bob } = await signIn("bob@b.org");
  const blocked = await bob.get(`/engagements/${engagementId}`);
  assert.equal(blocked.status, 404, "cross-tenant access was not blocked");

  // Reviewer: claim, reclassify, approve
  const { b: rita, landing: queue } = await signIn("rita@easier.company");
  assert.match(queue.url, /\/review$/);
  assert.match(text(queue), /Kōkua Learning Center/);
  let review = await rita.get(`/review/${engagementId}`);
  assert.match(text(review), /sealed until this engagement is assigned/);
  assert.doesNotMatch(review.html, /Leilani/, "unclaimed reviewer saw client content");
  review = await rita.submit(review, (f) => !!f.querySelector("input[name=engagementId]"));
  assert.match(text(review), /Account classification/);
  assert.match(text(review), /Timer running/, "claiming did not start the review timer");
  assert.match(text(review), /cannot sign until an admin verifies your credential/);

  review = await rita.submit(review, (f) => !!f.querySelector("select[name='map:6900']"), {
    "map:6900": "IX.13",
    "text:program.0": "Daily tutoring and homework help for 220 students in grades 3-8.",
  });
  assert.doesNotMatch(text(review), /could not be classified/);
  const approveForm = (f) => f.querySelector("input[name=action]")?.getAttribute("value") === "approve";
  assert.ok(review.doc.querySelectorAll("form").find(approveForm).querySelector("button[disabled]"), "approve enabled for unverified reviewer");
  review = await rita.submit(review, approveForm);
  assert.match(text(review), /credential has not been verified/);

  // Reviewer records a credential; an admin verifies it.
  let profile = await rita.get("/review/profile");
  profile = await rita.submit(profile, (f) => !!f.querySelector("input[name=ptin]"), {
    name: "Rita Reyes",
    credentialType: "EA",
    credentialNumber: "00123456",
    credentialJurisdiction: "IRS",
    ptin: "P01234567",
    efin: "123456",
  });
  assert.match(text(profile), /Saved\. An admin will verify it/);
  const { b: ada, landing: adaLanding } = await signIn("ada@easier.company");
  assert.match(adaLanding.url, /\/review$/);
  assert.match((await rita.get("/admin")).url, /\/review$/, "reviewer reached the admin page");
  let admin = await ada.get("/admin");
  assert.match(text(admin), /EA 00123456 \(IRS\)/);
  admin = await ada.submit(admin, (f) => f.querySelector("input[name=verified]")?.getAttribute("value") === "yes");
  assert.match(admin.html, /value="no"/, "credential not verified");

  review = await rita.get(`/review/${engagementId}`);
  review = await rita.submit(review, approveForm);
  assert.match(text(review), /Approved/);
  assert.doesNotMatch(text(review), /Timer running/, "approval did not stop the timer");

  // Manual time for work outside the platform.
  review = await rita.submit(review, (f) => !!f.querySelector("input[name=minutes]"), { minutes: "50", note: "Keyed return into Tax990" });
  assert.match(text(review), /time added/);

  // Deliver, record e-filing, then IRS acceptance.
  review = await rita.submit(review, (f) => f.querySelector("input[name=action]")?.getAttribute("value") === "deliver");
  assert.match(text(review), /Delivered/);
  const fileForm = (f) => f.querySelector("input[name=action]")?.getAttribute("value") === "record_filing";
  review = await rita.submit(review, fileForm, { submissionId: "not-an-id" });
  assert.match(text(review), /20-character IRS submission ID/);
  review = await rita.submit(review, fileForm, { submissionId: "12345620263200000abc" });
  assert.match(text(review), /Filed/);
  review = await rita.submit(review, (f) => f.querySelector("input[name=action]")?.getAttribute("value") === "record_acceptance");
  assert.match(text(review), /Accepted by IRS/);
  assert.match(text(review), /12345620263200000ABC/);

  // The keying sheet lists every exported line.
  const sheet = await rita.get(`/engagements/${engagementId}/package/return.csv`);
  assert.equal(sheet.status, 200, "return.csv not served");
  assert.match(sheet.headers.get("content-type"), /text\/csv/);
  assert.match(sheet.html, /^field,value\r\n/);
  assert.match(sheet.html, /partI\.12_totalRevenue\.currentYear,487500/);
  assert.equal((await bob.get(`/engagements/${engagementId}/package/return.csv`)).status, 404);

  // Admin records the invoice and sees the pilot gate.
  admin = await ada.get("/admin");
  assert.match(text(admin), /Full 990, mean reviewer hours/);
  assert.match(text(admin), /1 \/ 0/, "accepted count missing");
  admin = await ada.submit(admin, (f) => f.querySelector("input[name=engagementId]")?.getAttribute("value") === engagementId, {
    amount: "1950",
    issuedOn: "2026-10-01",
    paidOn: "2026-10-02",
    reference: "INV-001",
  });
  assert.match(text(admin), /\$1,950\.00 issued 2026-10-01, paid 2026-10-02/);

  // The approved return downloads as line-numbered data.
  const exported = await rita.get(`/engagements/${engagementId}/package/return.json`);
  assert.equal(exported.status, 200, "return.json not served");
  const ret = JSON.parse(exported.html);
  assert.equal(ret.form, "990");
  assert.equal(ret.partI["12_totalRevenue"].currentYear, 487500);
  assert.equal(ret.form8879TE.partI["1b_totalRevenue"], 487500);
  assert.ok(Array.isArray(ret.partIV) && ret.partIV.length === 53, "Part IV missing from export");

  // Client sees the signed package; edited narrative appears
  const pkg = await alice.get(`/engagements/${engagementId}/package`);
  assert.equal(pkg.status, 200);
  assert.match(text(pkg), /Daily tutoring and homework help/);
  assert.match(text(pkg), /Approved \d{4}-\d{2}-\d{2} by Rita Reyes, EA/);
  assert.match(text(pkg), /Submission ID: 12345620263200000ABC/);
  const bobPkg = await bob.get(`/engagements/${engagementId}/package`);
  assert.equal(bobPkg.status, 404);

  const audit = await alice.get(engagementUrl);
  assert.match(text(audit), /staff viewed/);
  console.log("E2E passed");
}

const stop = (code) => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
  rmSync(dbDir, { recursive: true, force: true });
  process.exit(code);
};

setTimeout(() => {
  console.error("E2E timed out\n--- server log ---\n" + log.slice(-4000));
  stop(1);
}, 240_000).unref();

main()
  .then(() => stop(0))
  .catch((err) => {
    console.error(err);
    console.error("--- server log ---\n" + log.slice(-4000));
    stop(1);
  });
