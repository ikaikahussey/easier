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

export const RELATED_TRANSACTION_TYPES = [
  { value: "a", label: "Receipt of interest, annuities, royalties, or rent from a controlled entity" },
  { value: "b", label: "Gift, grant, or capital contribution to related organization" },
  { value: "c", label: "Gift, grant, or capital contribution from related organization" },
  { value: "d", label: "Loans or loan guarantees to or for related organization" },
  { value: "e", label: "Loans or loan guarantees by related organization" },
  { value: "f", label: "Dividends from related organization" },
  { value: "g", label: "Sale of assets to related organization" },
  { value: "h", label: "Purchase of assets from related organization" },
  { value: "i", label: "Exchange of assets with related organization" },
  { value: "j", label: "Lease of facilities, equipment, or other assets to related organization" },
  { value: "k", label: "Lease of facilities, equipment, or other assets from related organization" },
  { value: "l", label: "Performance of services or membership or fundraising solicitations for related organization" },
  { value: "m", label: "Performance of services or membership or fundraising solicitations by related organization" },
  { value: "n", label: "Sharing of facilities, equipment, mailing lists, or other assets with related organization" },
  { value: "o", label: "Sharing of paid employees with related organization" },
  { value: "p", label: "Reimbursement paid to related organization for expenses" },
  { value: "q", label: "Reimbursement paid by related organization for expenses" },
  { value: "r", label: "Other transfer of cash or property to related organization" },
  { value: "s", label: "Other transfer of cash or property from related organization" },
] as const;

export interface RelatedTransaction {
  organization: string;
  type: (typeof RELATED_TRANSACTION_TYPES)[number]["value"];
  amount: number;
  method: string;
}

export interface ScheduleRIntake {
  related?: RelatedOrg[];
  relatedTransactions?: string;
  relatedTransactionList?: RelatedTransaction[];
}

export interface ScheduleROut {
  byPart: Record<"I" | "II" | "III" | "IV", (RelatedOrg & { incomeC: Cents; assetsC: Cents })[]>;
  partV: { line1: Record<string, boolean>; line2: (Omit<RelatedTransaction, "amount"> & { amountC: Cents; label: string })[] };
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
        { name: "relatedTransactions", type: "textarea", label: "Summary of transactions with related organizations this year" },
        {
          name: "relatedTransactionList",
          type: "list",
          label: "Each transaction with a related organization over $50,000 (Part V line 2)",
          rows: 5,
          fields: [
            { name: "organization", type: "text", label: "Related organization", required: true },
            { name: "type", type: "select", label: "Transaction type (Part V line 1)", required: true, options: RELATED_TRANSACTION_TYPES },
            { name: "amount", type: "money", label: "Amount involved ($)", required: true },
            { name: "method", type: "text", label: "Method of determining the amount (cost, fair market value, arm's length)", required: true },
          ],
        },
      ],
    },
  ],

  build(f) {
    const byPart: ScheduleROut["byPart"] = { I: [], II: [], III: [], IV: [] };
    for (const r of f.intake.related ?? []) byPart[PART[r.kind]].push({ ...r, incomeC: cents(r.income), assetsC: cents(r.assets) });
    const list = (f.intake.relatedTransactionList ?? []).map(({ amount, ...t }) => ({ ...t, amountC: cents(amount), label: RELATED_TRANSACTION_TYPES.find((x) => x.value === t.type)?.label ?? t.type }));
    const line1 = Object.fromEntries(RELATED_TRANSACTION_TYPES.map((t) => [t.value, list.some((x) => x.type === t.value)]));
    return { byPart, partV: { line1, line2: list.filter((t) => t.amountC > 50_000_00) } };
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
      severity: "warning",
      ref: "Schedule R, Part V",
      description: "Transactions with related organizations are itemized",
      check: ({ out, facts }) =>
        facts.intake.relatedTransactions && !(facts.intake.relatedTransactionList ?? []).length
          ? "Transactions with related organizations are described but not itemized; list each one for Part V"
          : !out.partV.line2.length && facts.parts.has("R-V")
            ? "Part IV reports transactions with a controlled entity or transfers to a non-charitable related organization, but none over $50,000 is listed for Part V line 2"
            : undefined,
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
    if (Object.values(out.partV.line1).some(Boolean) || out.partV.line2.length)
      s.push(table("sched-r-5", "Schedule R Part V: transactions with related organizations", [["line", "Line"], ["org", "(a) Related organization"], ["type", "(b) Transaction type"], ["amount", "(c) Amount involved", true], ["method", "(d) Method"]],
        out.partV.line2.map((t, k) => ({ line: String(k + 1), org: t.organization, type: `1${t.type}: ${t.label}`, amount: usd(t.amountC), method: t.method })),
        { note: `Line 1 Yes answers: ${Object.entries(out.partV.line1).filter(([, v]) => v).map(([k]) => `1${k}`).join(", ") || "none"}.` }));
    return s.length ? s : [table("sched-r", "Schedule R", [["status", "Status"]], [{ status: "No related organizations entered" }])];
  },
});
