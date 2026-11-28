/**
 * Launch preflight. Prints the environment checks from src/core/launch.ts and, when a
 * production build has SITE_ACCESS=open, fails the build if a blocking check fails, so a
 * deployment cannot open to the public half-configured (the previous deployment stays live).
 *
 *   node scripts/preflight.mjs            report
 *   node scripts/preflight.mjs --strict   fail on any blocker, whatever the environment
 *
 * Counsel review of the legal text is tracked at /admin, which sees the document versions.
 */
const env = process.env;
const strict = process.argv.includes("--strict");
const enforcing = strict || (env.SITE_ACCESS === "open" && env.VERCEL_ENV === "production");

let launch;
try {
  launch = await import("../src/core/launch.ts");
} catch (err) {
  // Needs a Node that strips TypeScript types (22.18 or later).
  console.error(`[preflight] could not load the launch checks: ${err.message}`);
  process.exit(enforcing ? 1 : 0);
}

const openLines = [];
if (launch.preparerNamed(env)) openLines.push("form-990", "books");
if (env.P120_ENABLED === "1") openLines.push("part-120");

// The legal text is reported at /admin; pass none here so this check reads as not evaluated.
const checks = launch.launchChecks(env, { openLines, draftDocuments: [] }).filter((c) => c.id !== "counsel");
const blockers = launch.launchBlockers(checks);

console.log(`[preflight] SITE_ACCESS=${env.SITE_ACCESS || "invite"}${enforcing ? " (enforcing)" : " (report only)"}`);
for (const c of checks) console.log(`[preflight] ${c.ok ? "ok   " : c.blocking ? "BLOCK" : "open "} ${c.label}: ${c.detail}`);

if (blockers.length && enforcing) {
  console.error(`[preflight] ${blockers.length} blocking item(s). The site will not open to the public until they are fixed.`);
  process.exit(1);
}
