import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { table } from "@/core/render";
import { cents, defineSchedule, usd } from "./common";

/**
 * Schedule R: Related Organizations and Unrelated Partnerships.
 * Part I: disregarded entities. Part II: related tax-exempt organizations.
 * Part III: related partnerships. Part IV: related corporations and trusts.
 */

export const RELATED_KINDS = [
  { value: "disregarded", label: "Disregarded entity, e.g. single-member LLC (Part I)" },
  { value: "exempt", label: "Related tax-exempt organization (Part II)" },
  { value: "partnership", label: "Related partnership or multi-member LLC (Part III)" },
  { value: "corporation", label: "Related taxable corporation or trust (Part IV)" },
] as const;

export interface RelatedOrg {
  kind: (typeof RELATED_KINDS)[number]["value"];
  name: string;
  ein?: string;
  address?: string;
  activity: string;
  domicile: string;
  controllingEntity?: string;
  exemptSection?: string;
  publicCharityStatus?: string;
  income?: number;
  assets?: number;
  controlled512b13?: boolean;
}

export interface ScheduleRIntake {
  related?: RelatedOrg[];
  relatedTransactions?: string;
}

export interface ScheduleROut {
  byPart: Record<"I" | "II" | "III" | "IV", (RelatedOrg & { incomeC: Cents; assetsC: Cents })[]>;
}

const PART: Record<RelatedOrg["kind"], keyof ScheduleROut["byPart"]> = { disregarded: "I", exempt: "II", partnership: "III", corporation: "IV" };

export const scheduleR = defineSchedule<ScheduleROut>({
  schedule: "R",
  title: "Related Organizations",
  intake: [
    {
      title: "Schedule R: related organizations",
      help: "Entities the organization controls, is controlled by, or shares control with, and any single-member LLCs it owns.",
      collapsible: true,
      fields: [
        {
          name: "related",
          type: "list",
          label: "Related organizations",
          rows: 3,
          fields: [
            { name: "kind", type: "select", label: "Type", required: true, options: RELATED_KINDS },
            { name: "name", type: "text", label: "Name", required: true },
            { name: "ein", type: "text", label: "EIN" },
            { name: "address", type: "text", label: "Address" },
            { name: "activity", type: "text", label: "Primary activity", required: true },
            { name: "domicile", type: "text", label: "Legal domicile (state or country)", required: true },
            { name: "controllingEntity", type: "text", label: "Direct controlling entity" },
            { name: "exemptSection", type: "text", label: "Exempt organizations: IRC section, e.g. 501(c)(3)" },
            { name: "publicCharityStatus", type: "text", label: "501(c)(3)s: public charity status, e.g. Schedule A line 7" },
            { name: "income", type: "money", label: "Disregarded, partnerships, corporations: total income ($)" },
            { name: "assets", type: "money", label: "Disregarded, partnerships, corporations: end-of-year assets ($)" },
            { name: "controlled512b13", type: "checkbox", label: "Controlled entity under section 512(b)(13)" },
          ],
        },
        { name: "relatedTransactions", type: "textarea", label: "Transactions with related organizations this year (loans, grants, sales, shared employees, reimbursements)" },
      ],
    },
  ],

  build(f) {
    const byPart: ScheduleROut["byPart"] = { I: [], II: [], III: [], IV: [] };
    for (const r of f.intake.related ?? []) byPart[PART[r.kind]].push({ ...r, incomeC: cents(r.income), assetsC: cents(r.assets) });
    return { byPart };
  },

  rules: [
    {
      id: "r.listed",
      severity: "error",
      ref: "Schedule R",
      description: "Related organizations are listed",
      check: ({ out }) => (Object.values(out.byPart).every((p) => !p.length) ? "The organization reported related organizations but none are listed" : undefined),
    },
    {
      id: "r.exempt_fields",
      severity: "warning",
      ref: "Schedule R, Part II columns (d)–(e)",
      description: "Related exempt organizations show section and status",
      check: ({ out }) => out.byPart.II.filter((r) => !r.exemptSection).map((r) => `Enter the exempt code section for ${r.name}`),
    },
    {
      id: "r.transactions",
      severity: "info",
      ref: "Schedule R, Part V",
      description: "Transactions with related organizations",
      check: ({ facts }) =>
        facts.intake.relatedTransactions
          ? "Report the related-organization transactions in Part V (line 1 checklist and line 2 amounts) by hand"
          : "Confirm with the client that there were no transactions with related organizations (Part V)",
    },
  ],

  render(out) {
    const s: ReviewSection[] = [];
    const name = (r: RelatedOrg) => [r.name, r.ein, r.address].filter(Boolean).join(", ");
    if (out.byPart.I.length)
      s.push(table("sched-r-1", "Schedule R Part I: disregarded entities", [["name", "(a) Name, EIN, address"], ["activity", "(b) Activity"], ["domicile", "(c) Domicile"], ["income", "(d) Total income", true], ["assets", "(e) End-of-year assets", true], ["control", "(f) Controlling entity"]],
        out.byPart.I.map((r) => ({ name: name(r), activity: r.activity, domicile: r.domicile, income: usd(r.incomeC), assets: usd(r.assetsC), control: r.controllingEntity ?? "—" }))));
    if (out.byPart.II.length)
      s.push(table("sched-r-2", "Schedule R Part II: related tax-exempt organizations", [["name", "(a) Name, EIN, address"], ["activity", "(b) Activity"], ["domicile", "(c) Domicile"], ["section", "(d) Exempt section"], ["status", "(e) Public charity status"], ["control", "(f) Controlling entity"], ["b13", "(g) 512(b)(13)"]],
        out.byPart.II.map((r) => ({ name: name(r), activity: r.activity, domicile: r.domicile, section: r.exemptSection ?? "—", status: r.publicCharityStatus ?? "—", control: r.controllingEntity ?? "—", b13: r.controlled512b13 ? "Yes" : "No" }))));
    if (out.byPart.III.length)
      s.push(table("sched-r-3", "Schedule R Part III: related partnerships", [["name", "(a) Name, EIN, address"], ["activity", "(b) Activity"], ["domicile", "(c) Domicile"], ["control", "(d) Controlling entity"], ["income", "(f) Total income", true], ["assets", "(g) End-of-year assets", true]],
        out.byPart.III.map((r) => ({ name: name(r), activity: r.activity, domicile: r.domicile, control: r.controllingEntity ?? "—", income: usd(r.incomeC), assets: usd(r.assetsC) })),
        { note: "Complete columns (e) and (h)–(k) (predominant income type, disproportionate allocations, K-1 amounts, general partner, ownership share) from the partnership's K-1." }));
    if (out.byPart.IV.length)
      s.push(table("sched-r-4", "Schedule R Part IV: related corporations and trusts", [["name", "(a) Name, EIN, address"], ["activity", "(b) Activity"], ["domicile", "(c) Domicile"], ["control", "(d) Controlling entity"], ["income", "(f) Share of total income", true], ["assets", "(g) Share of end-of-year assets", true], ["b13", "(i) 512(b)(13)"]],
        out.byPart.IV.map((r) => ({ name: name(r), activity: r.activity, domicile: r.domicile, control: r.controllingEntity ?? "—", income: usd(r.incomeC), assets: usd(r.assetsC), b13: r.controlled512b13 ? "Yes" : "No" })),
        { note: "Column (e) type of entity (C corporation, S corporation, trust) and column (h) percentage ownership are completed by the reviewer." }));
    return s.length ? s : [table("sched-r", "Schedule R", [["status", "Status"]], [{ status: "No related organizations entered" }])];
  },
});
