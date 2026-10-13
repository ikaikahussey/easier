import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { amt, cents, CONTRIBUTION_LINES, defineSchedule, pct, usd, type ScheduleFacts } from "./common";

/**
 * Schedule A (Form 990 or 990-EZ): Public Charity Status and Public Support.
 * Part I states the reason for public charity status. Part II (170(b)(1)(A)(vi) and
 * community trusts) and Part III (509(a)(2)) compute the five-year public support tests.
 */

export const CHARITY_STATUSES = [
  { value: "publicly_supported", line: 7, part: "II", label: "Receives a substantial part of its support from the public or government (170(b)(1)(A)(vi))" },
  { value: "509a2", line: 10, part: "III", label: "Normally receives more than one-third of support from gifts and related-activity receipts (509(a)(2))" },
  { value: "community_trust", line: 8, part: "II", label: "Community trust (170(b)(1)(A)(vi))" },
  { value: "church", line: 1, part: null, label: "Church, convention, or association of churches (170(b)(1)(A)(i))" },
  { value: "school", line: 2, part: null, label: "School (170(b)(1)(A)(ii)); also requires Schedule E" },
  { value: "hospital", line: 3, part: null, label: "Hospital or cooperative hospital service organization (170(b)(1)(A)(iii))" },
  { value: "government", line: 6, part: null, label: "Federal, state, or local government or governmental unit (170(b)(1)(A)(v))" },
  { value: "supporting", line: 12, part: null, label: "Supporting organization (509(a)(3))" },
] as const;

export type CharityStatus = (typeof CHARITY_STATUSES)[number]["value"];

export interface SupportYear {
  year: number;
  contributions: number;
  relatedReceipts?: number;
  investmentIncome?: number;
  unrelatedIncome?: number;
  otherIncome?: number;
  disqualifiedAmounts?: number;
}

export interface ScheduleAIntake {
  charityStatus?: CharityStatus;
  exemptSinceYear?: number;
  unusualGrants?: number;
  currentUnrelatedIncome?: number;
  currentDisqualifiedAmounts?: number;
  factsAndCircumstances?: boolean;
  factsAndCircumstancesExplanation?: string;
  priorPublicSupportPct?: number;
  priorInvestmentIncomePct?: number;
  supportHistory?: SupportYear[];
  receiptPayors?: { year: number; name: string; amount: number }[];
}

/** One row of a five-column Schedule A table: years (a)–(e) and total (f). */
export type Row = [Cents, Cents, Cents, Cents, Cents];
const total = (r: Row): Cents => r.reduce((t, v) => t + v, 0);
const zero = (): Row => [0, 0, 0, 0, 0];
const add = (...rows: Row[]): Row => zero().map((_, i) => rows.reduce((t, r) => t + r[i]!, 0)) as Row;
const sub = (a: Row, b: Row): Row => a.map((v, i) => v - b[i]!) as Row;

export interface PartII {
  line1: Row; line2: Row; line3: Row; line4: Row; line5: Cents; line6: Cents;
  line8: Row; line9: Row; line10: Row; line11: Row; line12: Row;
  excess: { name: string; fiveYear: Cents; excess: Cents }[];
  firstFive: boolean;
  line14: number;
  line15?: number;
  result: "13" | "16a" | "16b" | "17a" | "17b" | "fails";
}

export interface PartIII {
  line1: Row; line2: Row; line3: Row; line6: Row; line7a: Row; line7b: Row; line7c: Row; line8: Row;
  line10a: Row; line11: Row; line12: Row; line13: Row;
  firstFive: boolean;
  line15: number; line16?: number; line17: number; line18?: number;
  result: "14" | "19a" | "19b" | "fails";
}

export interface ScheduleAOut {
  status?: CharityStatus;
  line?: number;
  statusLabel?: string;
  years: number[];
  /** Prior years with no support history entered. */
  missingYears: number[];
  partII?: PartII;
  partIII?: PartIII;
  notes: string[];
}

const THIRD = 1 / 3;

/** Current-year figures taken from the classified ledger (after the event split). */
function currentYear(f: ScheduleFacts) {
  const i = f.intake;
  const contributions = amt(f, ...CONTRIBUTION_LINES) - cents(i.unusualGrants);
  const eventsNet = amt(f, "VIII.8a") - amt(f, "VIII.8b");
  const gamingNet = amt(f, "VIII.9a");
  return {
    contributions,
    related: amt(f, "VIII.2") + amt(f, "VIII.10a"),
    investment: amt(f, "VIII.3") + amt(f, "VIII.6a"),
    unrelated: cents(i.currentUnrelatedIncome),
    // Part II line 10: other support not reported elsewhere; event and gaming income net of direct costs.
    otherII: amt(f, "VIII.11") + eventsNet + gamingNet,
    // Part III line 3: gross receipts from activities that are not an unrelated trade or business.
    nonUbtiReceipts: amt(f, "VIII.8a") + amt(f, "VIII.9a"),
    otherIII: amt(f, "VIII.11"),
    disqualified: cents(i.currentDisqualifiedAmounts),
  };
}

function history(f: ScheduleFacts) {
  const years = [4, 3, 2, 1, 0].map((n) => f.taxYear - n);
  const byYear = new Map((f.intake.supportHistory ?? []).map((h) => [Number(h.year), h]));
  const missingYears = years.slice(0, 4).filter((y) => !byYear.has(y));
  const col = (pick: (h: SupportYear) => number | undefined, current: Cents): Row =>
    years.map((y, idx) => (idx === 4 ? current : cents(pick(byYear.get(y) ?? { year: y, contributions: 0 })))) as Row;
  return { years, missingYears, col };
}

const firstFiveYears = (f: ScheduleFacts) =>
  f.intake.exemptSinceYear !== undefined && f.taxYear - f.intake.exemptSinceYear < 5;

/** Contributors whose gifts count toward the 2% limit (governments and publicly supported charities are exempt). */
const SUBJECT_TO_LIMIT = new Set(["individual", "business", "foundation"]);

function partII(f: ScheduleFacts, h: ReturnType<typeof history>): PartII {
  const c = currentYear(f);
  const line1 = h.col((y) => y.contributions, c.contributions);
  const line2 = zero();
  const line3 = zero();
  const line4 = add(line1, line2, line3);
  const line8 = h.col((y) => y.investmentIncome, c.investment);
  const line9 = h.col((y) => y.unrelatedIncome, c.unrelated);
  const line10 = h.col((y) => y.otherIncome, c.otherII);
  const line11 = add(line4, line8, line9, line10);
  const line12 = h.col((y) => y.relatedReceipts, c.related);

  const limit = Math.round(total(line11) * 0.02);
  const excess = (f.intake.contributors ?? [])
    .filter((d) => SUBJECT_TO_LIMIT.has(d.kind))
    .map((d) => {
      const fiveYear = cents(d.fiveYearTotal ?? d.amount);
      return { name: d.name, fiveYear, excess: Math.max(0, fiveYear - limit) };
    })
    .filter((d) => d.excess > 0);
  const line5 = excess.reduce((t, d) => t + d.excess, 0);
  const line6 = total(line4) - line5;
  const line11f = total(line11);
  const line14 = pct(line6, line11f);
  const line15 = f.intake.priorPublicSupportPct;
  const firstFive = firstFiveYears(f);

  let result: PartII["result"];
  if (firstFive) result = "13";
  else if (line11f > 0 && line6 >= line11f * THIRD) result = "16a";
  else if (line15 !== undefined && line15 >= 100 / 3) result = "16b";
  else if (f.intake.factsAndCircumstances && line14 >= 10) result = "17a";
  else if (f.intake.factsAndCircumstances && line15 !== undefined && line15 >= 10) result = "17b";
  else result = "fails";

  return { line1, line2, line3, line4, line5, line6, line8, line9, line10, line11, line12, excess, firstFive, line14, line15, result };
}

function partIII(f: ScheduleFacts, h: ReturnType<typeof history>): PartIII {
  const c = currentYear(f);
  const line1 = h.col((y) => y.contributions, c.contributions);
  const line2 = h.col((y) => y.relatedReceipts, c.related);
  const line3 = h.col(() => 0, c.nonUbtiReceipts);
  const line6 = add(line1, line2, line3);
  const line7a = h.col((y) => y.disqualifiedAmounts, c.disqualified);
  const line10a = h.col((y) => y.investmentIncome, c.investment);
  const line11 = h.col((y) => y.unrelatedIncome, c.unrelated);
  const line12 = h.col((y) => y.otherIncome, c.otherIII);
  // Total support does not depend on line 7, so line 13 can be computed first.
  const line13 = add(line6, line10a, line11, line12);

  // 7b: receipts from one non-disqualified person above the greater of $5,000 or 1% of that year's line 13.
  const line7b = zero();
  for (const p of f.intake.receiptPayors ?? []) {
    const idx = h.years.indexOf(Number(p.year));
    if (idx < 0) continue;
    const threshold = Math.max(5_000_00, Math.round(line13[idx]! * 0.01));
    line7b[idx] = line7b[idx]! + Math.max(0, cents(p.amount) - threshold);
  }
  const line7c = add(line7a, line7b);
  const line8 = sub(line6, line7c);
  const line13f = total(line13);
  const line15 = pct(total(line8), line13f);
  const line17 = pct(total(line10a), line13f, 0);
  const firstFive = firstFiveYears(f);
  const line16 = f.intake.priorPublicSupportPct;
  const line18 = f.intake.priorInvestmentIncomePct;

  let result: PartIII["result"];
  if (firstFive) result = "14";
  else if (line13f > 0 && total(line8) > line13f * THIRD && total(line10a) <= line13f * THIRD) result = "19a";
  else if (line16 !== undefined && line18 !== undefined && line16 > 100 / 3 && line18 <= 100 / 3) result = "19b";
  else result = "fails";

  return { line1, line2, line3, line6, line7a, line7b, line7c, line8, line10a, line11, line12, line13, firstFive, line15, line16, line17, line18, result };
}

const RESULT_TEXT: Record<string, string> = {
  "13": "Line 13 checked: first five years as a 501(c)(3); public support test not yet applied",
  "16a": "Line 16a checked: meets the 33⅓% support test for this year",
  "16b": "Line 16b checked: meets the 33⅓% support test on the prior year's percentage",
  "17a": "Line 17a checked: meets the 10% facts-and-circumstances test for this year",
  "17b": "Line 17b checked: meets the 10% facts-and-circumstances test on the prior year's percentage",
  "14": "Line 14 checked: first five years as a 501(c)(3); support test not yet applied",
  "19a": "Line 19a checked: public support over 33⅓% and investment income not over 33⅓%",
  "19b": "Line 19b checked: meets the 509(a)(2) tests on the prior year's percentages",
  fails: "Fails the public support test: the organization may be classified as a private foundation (line 18 or 20)",
};

function rowsTable(id: string, title: string, years: number[], rows: [string, string, Row | Cents][], note?: string): ReviewSection {
  return table(
    id,
    title,
    [
      ["line", "Line"],
      ["label", "Description"],
      ...years.map((y, i) => [`c${i}`, `(${"abcde"[i]}) ${y}`, true] as [string, string, boolean]),
      ["f", "(f) Total", true],
    ],
    rows.map(([line, label, r]) =>
      Array.isArray(r)
        ? { line, label, ...Object.fromEntries(r.map((v, i) => [`c${i}`, usd(v)])), f: usd(total(r)) }
        : { line, label, ...Object.fromEntries(years.map((_, i) => [`c${i}`, ""])), f: usd(r) },
    ),
    { note },
  );
}

export const scheduleA = defineSchedule<ScheduleAOut>({
  schedule: "A",
  title: "Public Charity Status and Public Support",
  intake: [
    {
      title: "Schedule A: public charity status",
      help: "501(c)(3) organizations only. The support history covers the four years before this one; copy it from Schedule A Part II or III of last year's return.",
      collapsible: true,
      fields: [
        {
          name: "charityStatus",
          type: "select",
          label: "Why is the organization a public charity?",
          options: CHARITY_STATUSES.map(({ value, label }) => ({ value, label })),
        },
        { name: "exemptSinceYear", type: "number", label: "First tax year as a 501(c)(3) organization", min: 1900, max: 2100 },
        { name: "unusualGrants", type: "money", label: "Unusual grants received this year ($), excluded from public support", help: "Large, unexpected gifts from disinterested parties that would adversely affect the support test. Explain in Schedule A Part VI." },
        { name: "currentUnrelatedIncome", type: "money", label: "Net income from unrelated business activities this year ($)" },
        { name: "currentDisqualifiedAmounts", type: "money", label: "509(a)(2) only: amounts received this year from disqualified persons (substantial contributors, officers, directors, and their families) ($)" },
        { name: "factsAndCircumstances", type: "yesno", label: "If public support is between 10% and 33⅓%: does the organization meet the facts-and-circumstances test (ongoing public solicitation, broad governing body, public facilities or programs)?" },
        { name: "factsAndCircumstancesExplanation", type: "textarea", label: "How the organization meets the facts-and-circumstances test" },
        { name: "priorPublicSupportPct", type: "percent", label: "Public support percentage from last year's Schedule A (Part II line 14 or Part III line 15)" },
        { name: "priorInvestmentIncomePct", type: "percent", label: "509(a)(2) only: investment income percentage from last year's Schedule A (Part III line 17)" },
        {
          name: "supportHistory",
          type: "list",
          label: "Support history for the four prior years",
          rows: 4,
          fields: [
            { name: "year", type: "number", label: "Tax year", required: true, min: 1900, max: 2100 },
            { name: "contributions", type: "money", label: "Gifts, grants, contributions, and membership fees ($)", required: true },
            { name: "relatedReceipts", type: "money", label: "Program service revenue and other related-activity receipts ($)" },
            { name: "investmentIncome", type: "money", label: "Interest, dividends, rents, and royalties ($)" },
            { name: "unrelatedIncome", type: "money", label: "Net unrelated business income ($)" },
            { name: "otherIncome", type: "money", label: "Other income, excluding capital gains ($)" },
            { name: "disqualifiedAmounts", type: "money", label: "509(a)(2) only: amounts from disqualified persons ($)" },
          ],
        },
        {
          name: "receiptPayors",
          type: "list",
          label: "509(a)(2) only: any one payer (not a disqualified person) of more than $5,000 for program services or admissions in a year",
          rows: 5,
          fields: [
            { name: "year", type: "number", label: "Tax year", required: true, min: 1900, max: 2100 },
            { name: "name", type: "text", label: "Payer", required: true },
            { name: "amount", type: "money", label: "Amount paid that year ($)", required: true },
          ],
        },
      ],
    },
  ],

  build(f) {
    const status = f.intake.charityStatus;
    const def = CHARITY_STATUSES.find((s) => s.value === status);
    const h = history(f);
    const notes: string[] = [];
    const out: ScheduleAOut = {
      status,
      line: def?.line,
      statusLabel: def?.label,
      years: h.years,
      missingYears: def?.part ? h.missingYears : [],
      notes,
    };
    if (def?.part === "II") {
      out.partII = partII(f, h);
      notes.push(
        "Fundraising event and gaming income are on line 10, net of direct expenses; inventory sales are on line 12. Confirm the treatment for this organization.",
      );
    }
    if (def?.part === "III") {
      out.partIII = partIII(f, h);
      notes.push("Fundraising event admissions and gaming receipts are on line 3. Unrelated business income is on line 11; move amounts from businesses acquired after June 30, 1975 to line 10b.");
    }
    return out;
  },

  rules: [
    {
      id: "a.status_missing",
      severity: "error",
      ref: "Schedule A, Part I",
      description: "The reason for public charity status is given",
      check: ({ out }) => (out.status ? undefined : "Choose the reason for public charity status (Schedule A Part I)"),
    },
    {
      id: "a.status_unsupported",
      severity: "error",
      ref: "Schedule A, Part I",
      description: "Statuses that need parts this service does not yet prepare",
      check: ({ out }) =>
        out.status === "supporting"
          ? "Supporting organizations must complete Schedule A Part IV, which this service does not yet prepare"
          : out.status === "school"
            ? "Schools must also file Schedule E, which this service does not yet prepare"
            : out.status === "hospital"
              ? "Hospitals must also file Schedule H, which this service does not yet prepare"
              : undefined,
    },
    {
      id: "a.history_missing",
      severity: "error",
      ref: "Schedule A, Part II or III, columns (a)–(d)",
      description: "Support history covers the four prior years",
      check: ({ out }) => {
        const firstFive = out.partII?.firstFive || out.partIII?.firstFive;
        if (!out.missingYears.length || firstFive) return;
        return `Enter support history for ${out.missingYears.join(", ")}; the public support test uses five years`;
      },
    },
    {
      id: "a.history_missing_first_five",
      severity: "info",
      ref: "Schedule A, Part II or III",
      description: "Organizations in their first five years complete the years they have",
      check: ({ out }) =>
        out.missingYears.length && (out.partII?.firstFive || out.partIII?.firstFive)
          ? `No support history for ${out.missingYears.join(", ")}; leave those columns blank if the organization did not exist`
          : undefined,
    },
    {
      id: "a.fails_support_test",
      severity: "error",
      ref: "Schedule A, Part II line 18 / Part III line 20",
      description: "The organization meets a public support test",
      check: ({ out }) =>
        out.partII?.result === "fails" || out.partIII?.result === "fails"
          ? `${RESULT_TEXT.fails}. Review the support computation and the facts-and-circumstances answer before filing.`
          : undefined,
    },
    {
      id: "a.facts_explained",
      severity: "error",
      ref: "Schedule A, Part VI",
      description: "The facts-and-circumstances test is explained",
      check: ({ out, facts }) =>
        (out.partII?.result === "17a" || out.partII?.result === "17b") && !facts.intake.factsAndCircumstancesExplanation
          ? "Explain in Part VI how the organization meets the facts-and-circumstances test"
          : undefined,
    },
    {
      id: "a.unusual_grants",
      severity: "info",
      ref: "Schedule A, Part VI",
      description: "Unusual grants are listed in Part VI",
      check: ({ facts }) =>
        facts.intake.unusualGrants
          ? "Unusual grants were excluded from line 1; list each grantor, date, amount, and description in Part VI (not open to public inspection)"
          : undefined,
    },
    {
      id: "a.excess_contributors",
      severity: "info",
      ref: "Schedule A, Part II line 5",
      description: "Contributions above the 2% limit are excluded from public support",
      check: ({ out }) =>
        out.partII?.excess.length
          ? `${out.partII.excess.length} contributor(s) gave more than 2% of total support over five years; ${usd(out.partII.line5)} is excluded. Five-year totals default to this year's gift when not entered.`
          : undefined,
    },
  ],

  render(out) {
    const sections: ReviewSection[] = [
      fields("sched-a-1", "Schedule A Part I: reason for public charity status", [
        ["Line", out.line ? `Line ${out.line}` : undefined],
        ["Status", out.statusLabel],
      ]),
    ];
    const y = out.years;
    if (out.partII) {
      const p = out.partII;
      sections.push(
        rowsTable("sched-a-2a", "Schedule A Part II, Section A: public support", y, [
          ["1", "Gifts, grants, contributions, and membership fees", p.line1],
          ["2", "Tax revenues levied for the organization's benefit", p.line2],
          ["3", "Services or facilities furnished by a governmental unit", p.line3],
          ["4", "Total (lines 1–3)", p.line4],
          ["5", "Contributions above 2% of line 11, column (f)", p.line5],
          ["6", "Public support (line 4 minus line 5)", p.line6],
        ]),
        rowsTable("sched-a-2b", "Schedule A Part II, Section B: total support", y, [
          ["7", "Amounts from line 4", p.line4],
          ["8", "Interest, dividends, rents, royalties", p.line8],
          ["9", "Net income from unrelated business activities", p.line9],
          ["10", "Other income", p.line10],
          ["11", "Total support (lines 7–10)", p.line11],
          ["12", "Gross receipts from related activities", p.line12],
        ]),
        fields("sched-a-2c", "Schedule A Part II, Section C: public support percentage", [
          ["Line 14: public support percentage, this year", `${p.line14.toFixed(2)}%`],
          ["Line 15: public support percentage, prior year", p.line15 === undefined ? undefined : `${p.line15.toFixed(2)}%`],
          ["Result", RESULT_TEXT[p.result]],
        ]),
      );
      if (p.excess.length)
        sections.push(
          table(
            "sched-a-2-excess",
            "Schedule A Part II line 5: contributions above the 2% limit",
            [["name", "Contributor"], ["fiveYear", "Five-year contributions", true], ["excess", "Excess", true]],
            p.excess.map((d) => ({ name: d.name, fiveYear: usd(d.fiveYear), excess: usd(d.excess) })),
            { note: `2% of total support is ${usd(Math.round(total(p.line11) * 0.02))}.` },
          ),
        );
    }
    if (out.partIII) {
      const p = out.partIII;
      sections.push(
        rowsTable("sched-a-3a", "Schedule A Part III, Section A: public support", y, [
          ["1", "Gifts, grants, contributions, and membership fees", p.line1],
          ["2", "Gross receipts from related activities", p.line2],
          ["3", "Gross receipts from activities that are not an unrelated trade or business", p.line3],
          ["6", "Total (lines 1–5)", p.line6],
          ["7a", "Amounts from disqualified persons", p.line7a],
          ["7b", "Receipts from one person above the greater of $5,000 or 1% of line 13", p.line7b],
          ["7c", "Add lines 7a and 7b", p.line7c],
          ["8", "Public support (line 6 minus line 7c)", p.line8],
        ]),
        rowsTable("sched-a-3b", "Schedule A Part III, Section B: total support", y, [
          ["9", "Amounts from line 6", p.line6],
          ["10a", "Interest, dividends, rents, royalties", p.line10a],
          ["11", "Net income from unrelated business activities", p.line11],
          ["12", "Other income", p.line12],
          ["13", "Total support", p.line13],
        ]),
        fields("sched-a-3c", "Schedule A Part III, Sections C–D: percentages", [
          ["Line 15: public support percentage, this year", `${p.line15.toFixed(2)}%`],
          ["Line 16: public support percentage, prior year", p.line16 === undefined ? undefined : `${p.line16.toFixed(2)}%`],
          ["Line 17: investment income percentage, this year", `${p.line17}%`],
          ["Line 18: investment income percentage, prior year", p.line18 === undefined ? undefined : `${p.line18}%`],
          ["Result", RESULT_TEXT[p.result]],
        ]),
      );
    }
    if (out.notes.length) sections[sections.length - 1]!.note = out.notes.join(" ");
    return sections;
  },
});
