import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { amt, cents, defineSchedule, TIE, usd } from "./common";

/**
 * Schedule F: Statement of Activities Outside the United States.
 * Part I: activities by region. Part II: grants of more than $5,000 to foreign
 * organizations. Part III: grants to foreign individuals. Part IV: foreign forms.
 */

export const REGIONS = [
  "Central America and the Caribbean",
  "East Asia and the Pacific",
  "Europe (including Iceland and Greenland)",
  "Middle East and North Africa",
  "North America",
  "Russia and Neighboring States",
  "South America",
  "South Asia",
  "Sub-Saharan Africa",
  "Antarctica",
].map((r) => ({ value: r, label: r }));

export interface ScheduleFIntake {
  foreignRecords?: boolean;
  foreignMonitoring?: string;
  foreignRegions?: { region: string; offices?: number; staff?: number; activity: string; expenditures: number }[];
  foreignGrants?: { region: string; purpose: string; cash: number; manner?: string; noncash?: number; description?: string; individuals?: boolean; recipients?: number }[];
  foreignAccountsFbar?: boolean;
}

export interface ScheduleFOut {
  activities: { region: string; offices: number; staff: number; activity: string; expenditures: Cents }[];
  orgGrants: { region: string; purpose: string; cash: Cents; manner?: string; noncash: Cents; description?: string }[];
  individualGrants: { region: string; purpose: string; recipients: number; cash: Cents; noncash: Cents }[];
  totalExpenditures: Cents;
  ledgerForeignGrants: Cents;
}

export const scheduleF = defineSchedule<ScheduleFOut>({
  schedule: "F",
  title: "Activities Outside the United States",
  intake: [
    {
      title: "Schedule F: activities outside the United States",
      help: "Complete if the organization had more than $10,000 of revenue or expenses abroad, or made grants to foreign organizations or individuals.",
      collapsible: true,
      fields: [
        { name: "foreignRecords", type: "yesno", label: "Does the organization keep records of grant amounts, grantee eligibility, and selection for foreign grants?" },
        { name: "foreignMonitoring", type: "textarea", label: "How does the organization monitor the use of funds outside the United States?" },
        {
          name: "foreignRegions",
          type: "list",
          label: "Activities by region",
          rows: 3,
          fields: [
            { name: "region", type: "select", label: "Region", required: true, options: REGIONS },
            { name: "offices", type: "number", label: "Offices in the region", min: 0 },
            { name: "staff", type: "number", label: "Employees, agents, and contractors in the region", min: 0 },
            { name: "activity", type: "text", label: "Activities conducted (program services, grantmaking, fundraising, investments)", required: true },
            { name: "expenditures", type: "money", label: "Total expenditures in the region ($)", required: true },
          ],
        },
        {
          name: "foreignGrants",
          type: "list",
          label: "Grants made outside the United States",
          rows: 3,
          fields: [
            { name: "region", type: "select", label: "Region", required: true, options: REGIONS },
            { name: "purpose", type: "text", label: "Purpose of grant", required: true },
            { name: "cash", type: "money", label: "Cash grant ($)", required: true },
            { name: "manner", type: "text", label: "Manner of cash disbursement (wire, check)" },
            { name: "noncash", type: "money", label: "Noncash assistance ($)" },
            { name: "description", type: "text", label: "Description of noncash assistance" },
            { name: "individuals", type: "checkbox", label: "Grant was to individuals rather than an organization" },
            { name: "recipients", type: "number", label: "Grants to individuals: number of recipients", min: 0 },
          ],
        },
        { name: "foreignAccountsFbar", type: "yesno", label: "Did the organization have an interest in a foreign bank or financial account (FinCEN Form 114)?" },
      ],
    },
  ],

  build(f) {
    const grants = (f.intake.foreignGrants ?? []).map((g) => ({ ...g, cashC: cents(g.cash), noncashC: cents(g.noncash) }));
    const activities = (f.intake.foreignRegions ?? []).map((a) => ({
      region: a.region, offices: a.offices ?? 0, staff: a.staff ?? 0, activity: a.activity, expenditures: cents(a.expenditures),
    }));
    return {
      activities,
      orgGrants: grants
        .filter((g) => !g.individuals && g.cashC + g.noncashC > 5_000_00)
        .map((g) => ({ region: g.region, purpose: g.purpose, cash: g.cashC, manner: g.manner, noncash: g.noncashC, description: g.description })),
      individualGrants: grants
        .filter((g) => g.individuals)
        .map((g) => ({ region: g.region, purpose: g.purpose, recipients: g.recipients ?? 0, cash: g.cashC, noncash: g.noncashC })),
      totalExpenditures: activities.reduce((t, a) => t + a.expenditures, 0),
      ledgerForeignGrants: amt(f, "IX.3"),
    };
  },

  rules: [
    {
      id: "f.activities",
      severity: "error",
      ref: "Schedule F, Part I line 3",
      description: "Foreign activities are listed by region",
      check: ({ out }) => (out.activities.length ? undefined : "List the organization's activities outside the United States by region"),
    },
    {
      id: "f.monitoring",
      severity: "error",
      ref: "Schedule F, Part I lines 1–2",
      description: "Grant records and monitoring are described",
      check: ({ out, facts }) =>
        (out.orgGrants.length || out.individualGrants.length) && (facts.intake.foreignRecords === undefined || !facts.intake.foreignMonitoring)
          ? "Answer whether foreign grant records are kept and describe monitoring of funds"
          : undefined,
    },
    {
      id: "f.grants_tie",
      severity: "warning",
      ref: "Schedule F vs Part IX line 3",
      description: "Foreign grants agree with the books",
      check: ({ out, facts }) => {
        const entered = (facts.intake.foreignGrants ?? []).reduce((t, g) => t + cents(g.cash) + cents(g.noncash), 0);
        return Math.abs(entered - out.ledgerForeignGrants) > TIE
          ? `Foreign grants entered (${usd(entered)}) differ from Part IX line 3 (${usd(out.ledgerForeignGrants)})`
          : undefined;
      },
    },
    {
      id: "f.part_iv",
      severity: "info",
      ref: "Schedule F, Part IV",
      description: "Foreign filing questions",
      check: () => "Confirm with the client whether Forms 926, 3520, 3520-A, 5471, 8865, 8858, 5713, or 8621 were required (Part IV)",
    },
  ],

  render(out, f) {
    const s: ReviewSection[] = [
      fields("sched-f-1q", "Schedule F Part I: general information", [
        ["Line 1: grant records maintained", f.intake.foreignRecords],
        ["Line 2: monitoring of funds", f.intake.foreignMonitoring],
        ["Foreign financial account (FinCEN 114)", f.intake.foreignAccountsFbar],
      ]),
      table(
        "sched-f-1",
        "Schedule F Part I line 3: activities by region",
        [["region", "(a) Region"], ["offices", "(b) Offices", true], ["staff", "(c) Employees and agents", true], ["activity", "(d) Activities"], ["expenditures", "(f) Total expenditures", true]],
        out.activities.map((a) => ({ region: a.region, offices: a.offices, staff: a.staff, activity: a.activity, expenditures: usd(a.expenditures) })),
        { footer: { region: "Total", offices: "", staff: "", activity: "", expenditures: usd(out.totalExpenditures) } },
      ),
    ];
    if (out.orgGrants.length)
      s.push(table("sched-f-2", "Schedule F Part II: grants to foreign organizations over $5,000", [["region", "(b) Region"], ["purpose", "(c) Purpose"], ["cash", "(e) Cash", true], ["manner", "(f) Manner"], ["noncash", "(g) Noncash", true], ["description", "(h) Description"]],
        out.orgGrants.map((g) => ({ region: g.region, purpose: g.purpose, cash: usd(g.cash), manner: g.manner ?? "—", noncash: usd(g.noncash), description: g.description ?? "—" })),
        { note: "Column (a) (name of organization) is not required; column (d) IRC section and the equivalency determination are completed by the reviewer." }));
    if (out.individualGrants.length)
      s.push(table("sched-f-3", "Schedule F Part III: grants to foreign individuals", [["purpose", "(a) Type of assistance"], ["region", "(b) Region"], ["recipients", "(c) Recipients", true], ["cash", "(d) Cash", true], ["noncash", "(f) Noncash", true]],
        out.individualGrants.map((g) => ({ purpose: g.purpose, region: g.region, recipients: g.recipients, cash: usd(g.cash), noncash: usd(g.noncash) }))));
    return s;
  },
});
