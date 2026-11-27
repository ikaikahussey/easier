/**
 * Priority evaluation for easier.company.
 *
 *   node scripts/priorities.mjs            # prints the ranked list as Markdown
 *
 * The founder's stated order is: (1) mitigate risk and liability, (2) maximize revenue,
 * (3) find defensible niches and moats. This script applies that order with three changes:
 *
 *   1. Risk is a gate, not a quantity to maximize. "Minimize risk first" has no stopping
 *      point (the lowest-risk business does nothing). Each service line lists the gates that
 *      must be closed before it may take a paying customer. Closing gates is the risk work.
 *   2. A gate is worth what it unblocks. Gates are ranked by the value of the lines behind
 *      them divided by the effort to close them, so risk work on a line that will not sell
 *      ranks last. Exposure that is live today (severity x likelihood >= LIVE_THRESHOLD)
 *      skips this and goes first.
 *   3. Moat multiplies revenue instead of trailing it, and lead time can jump the queue:
 *      an item whose deadline minus lead time falls inside LEAD_WINDOW_DAYS is pulled up,
 *      least slack first.
 *
 * Two rules keep the list honest:
 *   - A gated line gets no revenue or moat work except demand tests (cheap, no customer).
 *   - At most WIP_LINES lines are active; the rest are parked.
 *
 * Every number in LINES and ITEMS is an estimate entered by hand. Change them and rerun.
 */

const TODAY = new Date(process.env.PRIORITIES_TODAY ?? "2026-11-26");
const LIVE_THRESHOLD = 12; // severity (1-5) x likelihood (1-5)
const LEAD_WINDOW_DAYS = 30;
const MOAT_WEIGHT = 0.15;
const WIP_LINES = 2;

/**
 * net:   expected net revenue in the 12 months after the gates close, in $ thousands
 * months: months from gates closed to first dollar
 * moat:  0-5, how hard the position is to copy once won
 * p:     probability the gates close within 90 days
 */
const LINES = {
  tax: { name: "Easier Tax (Form 990)", net: 36, months: 3, moat: 3, p: 0.5, note: "50 clients x ~$1,200 x 60% margin (season-one gate in the strategy review)" },
  part120: { name: "Part 120 Compliance Desk", net: 12, months: 2, moat: 3, p: 0.5, note: "8 certificates x ~$1,500; no licensed reviewer needed" },
  books: { name: "Easier Books (monthly close)", net: 20, months: 4, moat: 2, p: 0.4, note: "shares Tax's reviewer gate; recurring" },
  payroll: { name: "Easier Payroll", net: 10, months: 3, moat: 1, p: 0.2, note: "unmerged; no deposits or filings; wrong withholding is direct liability" },
  comms: { name: "Easier Comms (builder platform)", net: 5, months: 6, moat: 1, p: 0.2, note: "concept stage" },
  marketing: { name: "Marketing agency", net: 5, months: 6, moat: 1, p: 0.2, note: "concept stage" },
};

/**
 * kind: gate | demand | revenue | moat
 * lines: lines the item gates or serves ("*" = every line)
 * days: effort; owner: agent (software, done in-session) | founder | outside (licensed or legal professional)
 * sev, like: only for exposure that exists today
 * deadline, lead: ISO date and lead time in days, when a clock applies
 */
const ITEMS = [
  { id: "reviewer", kind: "gate", lines: ["tax", "books"], days: 5, owner: "founder", deadline: "2027-01-15", lead: 30, what: "Sign one EA or CPA as reviewer of record (outreach drafts exist)" },
  { id: "efin", kind: "gate", lines: ["tax"], days: 1, owner: "founder", deadline: "2027-02-01", lead: 45, what: "File the firm's EFIN application (up to 45 days)" },
  { id: "counsel", kind: "gate", lines: ["*"], days: 3, owner: "outside", what: "Counsel review of engagement letter, IRC 7216 consent, and Part 120 terms" },
  { id: "insurance", kind: "gate", lines: ["*"], days: 2, owner: "founder", what: "Bind E&O and cyber coverage" },
  { id: "db-split", kind: "gate", lines: ["*"], days: 0.5, owner: "founder", sev: 4, like: 2, what: "Give preview its own database and encryption key (today it shares production's)" },
  { id: "email", kind: "gate", lines: ["*"], days: 0.1, owner: "founder", sev: 3, like: 3, what: "Turn on production email (sign-in links currently go to the server log)" },
  { id: "wisp", kind: "gate", lines: ["tax", "books", "payroll"], days: 0.5, owner: "founder", what: "Adopt the written information security plan (draft exists)" },
  { id: "efile-route", kind: "gate", lines: ["tax"], days: 2, owner: "founder", deadline: "2027-01-15", lead: 14, what: "Choose the e-file route for the 2027 season" },
  { id: "p120-terms", kind: "gate", lines: ["part120"], days: 0.5, owner: "agent", what: "Part 120: terms accepted and recorded at enrollment" },
  { id: "p120-review", kind: "gate", lines: ["part120"], days: 2, owner: "outside", what: "Part 120: rule values reviewed by a Drug Abatement practitioner (packet prepared)" },
  { id: "p120-packet", kind: "gate", lines: ["part120"], days: 0.3, owner: "agent", what: "Part 120: review packet listing every rule value, citation, and open question" },
  { id: "p120-rates", kind: "gate", lines: ["part120"], days: 0.1, owner: "agent", deadline: "2027-01-01", lead: 7, what: "Part 120: load 2027 random testing rates when the FAA publishes them" },
  { id: "payroll-tables", kind: "gate", lines: ["payroll"], days: 2, owner: "agent", deadline: "2027-01-01", lead: 14, what: "Payroll: 2027 federal and Hawaii tables; confirm TDI and UI with DLIR" },
  { id: "p120-page", kind: "demand", lines: ["part120"], days: 0.5, owner: "agent", what: "Part 120: operator page with an access request form" },
  { id: "tax-outreach", kind: "revenue", lines: ["tax"], days: 5, owner: "founder", what: "Season-one outreach to calendar-year nonprofits (returns due May 17, 2027)" },
  { id: "p120-outreach", kind: "revenue", lines: ["part120"], days: 3, owner: "founder", what: "Part 120: three to five design-partner operators; approach two administrators about wholesale" },
  { id: "payments", kind: "revenue", lines: ["*"], days: 2, owner: "agent", what: "Card and ACH payments (needs a Stripe account); manual invoices work until then" },
  { id: "mef", kind: "moat", lines: ["tax"], days: 15, owner: "agent", what: "Own MeF transmitter (developer application, assurance testing)" },
  { id: "hours-data", kind: "moat", lines: ["tax", "books"], days: 1, owner: "agent", what: "Reviewer-hours benchmark from every engagement (timer exists; report does not)" },
  { id: "part40", kind: "moat", lines: ["part120"], days: 10, owner: "agent", what: "Extend the Part 40 engine to a second DOT mode (trucking) after the first aviation customers" },
];

const lineValue = (l) => (l.net * l.p * (1 + MOAT_WEIGHT * l.moat)) / Math.max(l.months, 1);
const ranked = Object.entries(LINES)
  .map(([id, l]) => ({ id, ...l, value: lineValue(l) }))
  .sort((a, b) => b.value - a.value);
const active = new Set(ranked.slice(0, WIP_LINES).map((l) => l.id));
// A parked line rides along when it has gates of its own and an active line already pays for all of them.
const linesOf = (it) => (it.lines.includes("*") ? Object.keys(LINES) : it.lines);
const gatesOf = (line) => ITEMS.filter((it) => it.kind === "gate" && linesOf(it).includes(line));
for (const l of ranked) {
  if (active.has(l.id)) continue;
  const specific = gatesOf(l.id).filter((g) => !g.lines.includes("*"));
  if (specific.length > 0 && specific.every((g) => linesOf(g).some((x) => active.has(x)))) active.add(l.id);
}

const daysUntil = (iso) => Math.round((new Date(iso) - TODAY) / 86_400_000);
const unblocked = (it) => linesOf(it).filter((l) => active.has(l)).reduce((sum, l) => sum + lineValue(LINES[l]), 0);

function tier(it) {
  if ((it.sev ?? 0) * (it.like ?? 0) >= LIVE_THRESHOLD) return 0; // live exposure
  if (!linesOf(it).some((l) => active.has(l))) return 9; // parked line
  if (it.deadline && daysUntil(it.deadline) - (it.lead ?? 0) <= LEAD_WINDOW_DAYS) return 1; // the clock is running
  return { gate: 2, demand: 3, revenue: 4, moat: 5 }[it.kind];
}

const scored = ITEMS.map((it) => {
  const value = unblocked(it);
  const moat = it.kind === "moat" ? Math.max(...linesOf(it).map((l) => LINES[l].moat)) : 1;
  const slack = it.deadline ? daysUntil(it.deadline) - (it.lead ?? 0) : undefined;
  return { ...it, tier: tier(it), score: (value * moat) / it.days, slack };
}).sort((a, b) => a.tier - b.tier || (a.tier === 1 ? a.slack - b.slack : b.score - a.score));

const TIERS = { 0: "Live exposure", 1: "Clock running", 2: "Gate", 3: "Demand test", 4: "Revenue", 5: "Moat", 9: "Parked" };
const out = [];
out.push("| Line | Est. net 12 mo ($k) | Months to first $ | Moat | P(gates close in 90 d) | Value | Status |", "|---|---:|---:|---:|---:|---:|---|");
for (const l of ranked) out.push(`| ${l.name} | ${l.net} | ${l.months} | ${l.moat} | ${l.p} | ${l.value.toFixed(2)} | ${active.has(l.id) ? "Active" : "Parked"} |`);
out.push("", "| # | Tier | Item | Owner | Days | Score | Slack (days) |", "|---:|---|---|---|---:|---:|---:|");
scored.forEach((it, n) => out.push(`| ${n + 1} | ${TIERS[it.tier]} | ${it.what} | ${it.owner} | ${it.days} | ${it.tier === 9 ? "" : it.score.toFixed(1)} | ${it.slack ?? ""} |`));
const live = scored.filter((it) => it.tier === 0).length;
out.push("", `Live exposures at or above the threshold: ${live}. Active lines: ${[...active].map((id) => LINES[id].name).join("; ")}.`);
console.log(out.join("\n"));
