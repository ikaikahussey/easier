import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { amt, cents, defineSchedule, TIE, usd } from "./common";

/**
 * Schedule I: Grants and Other Assistance to Organizations, Governments, and
 * Individuals in the United States. Part II lists each recipient organization that
 * received more than $5,000; Part III groups assistance to individuals by type.
 */

export const IRC_SECTIONS = [
  { value: "501(c)(3)", label: "501(c)(3) charity" },
  { value: "government", label: "Government unit" },
  { value: "501(c)(4)", label: "501(c)(4)" },
  { value: "other", label: "Other" },
] as const;

export interface ScheduleIIntake {
  grantRecords?: boolean;
  grantMonitoring?: string;
  grantsToOrgs?: { name: string; address?: string; ein?: string; section: (typeof IRC_SECTIONS)[number]["value"]; cash: number; noncash?: number; noncashDescription?: string; valuation?: string; purpose: string }[];
  grantsToIndividuals?: { type: string; recipients: number; cash: number; noncash?: number; noncashDescription?: string; valuation?: string }[];
}

export interface ScheduleIOut {
  orgs: { name: string; address?: string; ein?: string; section: string; cash: Cents; noncash: Cents; noncashDescription?: string; valuation?: string; purpose: string }[];
  count501c3: number;
  countOther: number;
  individuals: { type: string; recipients: number; cash: Cents; noncash: Cents; noncashDescription?: string; valuation?: string }[];
  ledgerOrgs: Cents;
  ledgerIndividuals: Cents;
  part: { II: boolean; III: boolean };
}

const LISTING_THRESHOLD = 5_000_00;

export const scheduleI = defineSchedule<ScheduleIOut>({
  schedule: "I",
  title: "Grants and Other Assistance in the United States",
  intake: [
    {
      title: "Schedule I: grants and assistance paid",
      help: "List each organization or government the organization granted more than $5,000 this year, and assistance to individuals grouped by type (for example, scholarships or emergency assistance).",
      collapsible: true,
      fields: [
        { name: "grantRecords", type: "yesno", label: "Does the organization keep records of grant amounts, grantee eligibility, and how grantees were selected?" },
        { name: "grantMonitoring", type: "textarea", label: "How does the organization monitor the use of grant funds?" },
        {
          name: "grantsToOrgs",
          type: "list",
          label: "Grants of more than $5,000 to one organization or government",
          rows: 5,
          fields: [
            { name: "name", type: "text", label: "Recipient", required: true },
            { name: "address", type: "text", label: "Address" },
            { name: "ein", type: "text", label: "EIN" },
            { name: "section", type: "select", label: "Recipient's tax status", required: true, options: IRC_SECTIONS },
            { name: "cash", type: "money", label: "Cash grant ($)", required: true },
            { name: "noncash", type: "money", label: "Noncash assistance ($)" },
            { name: "noncashDescription", type: "text", label: "Description of noncash assistance" },
            { name: "valuation", type: "text", label: "Valuation method for noncash (book, fair market value, appraisal)" },
            { name: "purpose", type: "text", label: "Purpose of grant", required: true },
          ],
        },
        {
          name: "grantsToIndividuals",
          type: "list",
          label: "Grants and assistance to individuals, by type",
          rows: 3,
          fields: [
            { name: "type", type: "text", label: "Type of assistance", required: true },
            { name: "recipients", type: "number", label: "Number of recipients", required: true, min: 0 },
            { name: "cash", type: "money", label: "Cash ($)", required: true },
            { name: "noncash", type: "money", label: "Noncash ($)" },
            { name: "noncashDescription", type: "text", label: "Description of noncash assistance" },
            { name: "valuation", type: "text", label: "Valuation method for noncash" },
          ],
        },
      ],
    },
  ],

  build(f) {
    const orgs = (f.intake.grantsToOrgs ?? [])
      .map((g) => ({ ...g, cash: cents(g.cash), noncash: cents(g.noncash) }))
      .filter((g) => g.cash + g.noncash > LISTING_THRESHOLD);
    const individuals = (f.intake.grantsToIndividuals ?? []).map((g) => ({ ...g, cash: cents(g.cash), noncash: cents(g.noncash) }));
    return {
      orgs,
      count501c3: orgs.filter((g) => g.section === "501(c)(3)" || g.section === "government").length,
      countOther: orgs.filter((g) => g.section !== "501(c)(3)" && g.section !== "government").length,
      individuals,
      ledgerOrgs: amt(f, "IX.1"),
      ledgerIndividuals: amt(f, "IX.2"),
      part: { II: f.parts.has("I-II"), III: f.parts.has("I-III") },
    };
  },

  rules: [
    {
      id: "i.records",
      severity: "error",
      ref: "Schedule I, Part I lines 1–2",
      description: "Grant records and monitoring are answered",
      check: ({ facts }) =>
        facts.intake.grantRecords === undefined || !facts.intake.grantMonitoring
          ? "Answer whether grant records are kept and describe how grant use is monitored"
          : undefined,
    },
    {
      id: "i.orgs_over_ledger",
      severity: "error",
      ref: "Schedule I Part II vs Part IX line 1",
      description: "Listed grants do not exceed grants to organizations in the books",
      check: ({ out }) => {
        const listed = out.orgs.reduce((t, g) => t + g.cash, 0);
        return listed - out.ledgerOrgs > TIE
          ? `Cash grants listed (${usd(listed)}) exceed grants to organizations on Part IX line 1 (${usd(out.ledgerOrgs)})`
          : undefined;
      },
    },
    {
      id: "i.no_large_grant",
      severity: "info",
      ref: "Form 990 Part IV, line 21",
      description: "Schedule I Part II applies only if one grantee received more than $5,000",
      check: ({ out }) =>
        out.part.II && !out.orgs.length
          ? `Grants to organizations total ${usd(out.ledgerOrgs)}, but no single grantee over $5,000 is listed. If none received more than $5,000, answer Part IV line 21 "No"; otherwise list them.`
          : undefined,
    },
    {
      id: "i.individuals_tie",
      severity: "warning",
      ref: "Schedule I Part III vs Part IX line 2",
      description: "Assistance to individuals ties to the books",
      check: ({ out }) => {
        if (!out.part.III) return;
        const listed = out.individuals.reduce((t, g) => t + g.cash + g.noncash, 0);
        return Math.abs(listed - out.ledgerIndividuals) > TIE
          ? `Assistance to individuals entered (${usd(listed)}) differs from Part IX line 2 (${usd(out.ledgerIndividuals)})`
          : undefined;
      },
    },
    {
      id: "i.noncash_valued",
      severity: "warning",
      ref: "Schedule I, columns (f)–(g)",
      description: "Noncash assistance has a description and valuation method",
      check: ({ out }) =>
        [...out.orgs.map((g) => ({ who: g.name, ...g })), ...out.individuals.map((g) => ({ who: g.type, ...g }))]
          .filter((g) => g.noncash > 0 && (!g.noncashDescription || !g.valuation))
          .map((g) => `Describe and value the noncash assistance to ${g.who}`),
    },
  ],

  render(out, f) {
    const s: ReviewSection[] = [
      fields("sched-i-1", "Schedule I Part I: general information", [
        ["Line 1: grant records maintained", f.intake.grantRecords],
        ["Line 2: monitoring of grant use (Part IV)", f.intake.grantMonitoring],
      ]),
    ];
    if (out.orgs.length || out.part.II)
      s.push(
        table(
          "sched-i-2",
          "Schedule I Part II: grants to organizations and governments",
          [["name", "(a) Name and address"], ["ein", "(b) EIN"], ["section", "(c) IRC section"], ["cash", "(d) Cash grant", true], ["noncash", "(e) Noncash", true], ["valuation", "(f) Valuation"], ["description", "(g) Noncash description"], ["purpose", "(h) Purpose"]],
          out.orgs.map((g) => ({ name: [g.name, g.address].filter(Boolean).join(", "), ein: g.ein ?? "—", section: g.section, cash: usd(g.cash), noncash: usd(g.noncash), valuation: g.valuation ?? "—", description: g.noncashDescription ?? "—", purpose: g.purpose })),
          { note: `Line 2: ${out.count501c3} section 501(c)(3) and government recipients. Line 3: ${out.countOther} other recipients.` },
        ),
      );
    if (out.individuals.length || out.part.III)
      s.push(
        table(
          "sched-i-3",
          "Schedule I Part III: grants and assistance to individuals",
          [["type", "(a) Type"], ["recipients", "(b) Recipients", true], ["cash", "(c) Cash", true], ["noncash", "(d) Noncash", true], ["valuation", "(e) Valuation"], ["description", "(f) Description"]],
          out.individuals.map((g) => ({ type: g.type, recipients: g.recipients, cash: usd(g.cash), noncash: usd(g.noncash), valuation: g.valuation ?? "—", description: g.noncashDescription ?? "—" })),
        ),
      );
    return s;
  },
});
