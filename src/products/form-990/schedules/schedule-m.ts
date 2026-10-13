import type { Cents } from "@/core/money";
import { fields, table } from "@/core/render";
import { cents, defineSchedule, usd } from "./common";

/** Schedule M: Noncash Contributions (required when noncash contributions exceed $25,000). */

export const NONCASH_TYPES = [
  { value: "1", label: "Art: works of art" },
  { value: "2", label: "Art: historical treasures" },
  { value: "4", label: "Books and publications" },
  { value: "5", label: "Clothing and household goods" },
  { value: "6", label: "Cars and other vehicles" },
  { value: "7", label: "Boats and planes" },
  { value: "8", label: "Intellectual property" },
  { value: "9", label: "Securities: publicly traded" },
  { value: "10", label: "Securities: closely held stock" },
  { value: "11", label: "Securities: partnership, LLC, or trust interests" },
  { value: "12", label: "Securities: miscellaneous" },
  { value: "15", label: "Real estate: residential" },
  { value: "16", label: "Real estate: commercial" },
  { value: "17", label: "Real estate: other" },
  { value: "18", label: "Collectibles" },
  { value: "19", label: "Food inventory" },
  { value: "20", label: "Drugs and medical supplies" },
  { value: "25", label: "Other (describe)" },
] as const;

export interface ScheduleMIntake {
  noncash?: { type: (typeof NONCASH_TYPES)[number]["value"]; count: number; amount: number; method: string; description?: string }[];
  forms8283?: number;
  noncashHeld3Years?: boolean;
  giftAcceptancePolicy?: boolean;
  thirdPartyProcessors?: boolean;
}

export interface ScheduleMOut {
  rows: { line: string; label: string; count: number; amount: Cents; method: string; description?: string }[];
  total: Cents;
}

export const scheduleM = defineSchedule<ScheduleMOut>({
  schedule: "M",
  title: "Noncash Contributions",
  intake: [
    {
      title: "Schedule M: noncash contributions",
      help: "Complete if the organization received more than $25,000 of donated property (stock, vehicles, goods, real estate) this year. Donated services and use of facilities are not included.",
      collapsible: true,
      fields: [
        {
          name: "noncash",
          type: "list",
          label: "Property received, by type",
          rows: 4,
          fields: [
            { name: "type", type: "select", label: "Type of property", required: true, options: NONCASH_TYPES },
            { name: "count", type: "number", label: "Number of contributions or items", required: true, min: 0 },
            { name: "amount", type: "money", label: "Amount reported as revenue ($)", required: true },
            { name: "method", type: "text", label: "How the amount was determined (appraisal, sale price, market quote)", required: true },
            { name: "description", type: "text", label: "Description (for Other)" },
          ],
        },
        { name: "forms8283", type: "number", label: "Number of Forms 8283 received and signed (property over $5,000)", min: 0 },
        { name: "noncashHeld3Years", type: "yesno", label: "Did the organization receive property it must hold for at least three years and not use for its exempt purposes?" },
        { name: "giftAcceptancePolicy", type: "yesno", label: "Does the organization have a gift acceptance policy for non-standard contributions?" },
        { name: "thirdPartyProcessors", type: "yesno", label: "Did the organization use third parties to solicit, process, or sell noncash contributions?" },
      ],
    },
  ],

  build(f) {
    const rows = (f.intake.noncash ?? []).map((r) => ({
      line: r.type,
      label: NONCASH_TYPES.find((t) => t.value === r.type)?.label ?? r.type,
      count: r.count,
      amount: cents(r.amount),
      method: r.method,
      description: r.description,
    }));
    return { rows, total: rows.reduce((t, r) => t + r.amount, 0) };
  },

  rules: [
    {
      id: "m.listed",
      severity: "error",
      ref: "Schedule M, Part I",
      description: "Noncash contributions are listed by type",
      check: ({ out }) => (out.rows.length ? undefined : "List noncash contributions by type of property"),
    },
    {
      id: "m.over_threshold",
      severity: "warning",
      ref: "Form 990 Part IV, line 29",
      description: "Schedule M applies above $25,000",
      check: ({ out }) =>
        out.rows.length && out.total <= 25_000_00
          ? `Noncash contributions total ${usd(out.total)}, not more than $25,000; Schedule M may not be required`
          : undefined,
    },
    {
      id: "m.other_described",
      severity: "error",
      ref: "Schedule M, lines 25–28",
      description: "Other property is described",
      check: ({ out }) => out.rows.filter((r) => r.line === "25" && !r.description).map(() => "Describe the property reported as Other"),
    },
    {
      id: "m.questions",
      severity: "warning",
      ref: "Schedule M, lines 29–32",
      description: "Schedule M questions are answered",
      check: ({ facts }) =>
        facts.intake.forms8283 === undefined || facts.intake.giftAcceptancePolicy === undefined || facts.intake.thirdPartyProcessors === undefined
          ? "Answer the Forms 8283, gift acceptance policy, and third-party processor questions"
          : undefined,
    },
  ],

  render(out, f) {
    return [
      table(
        "sched-m-1",
        "Schedule M Part I: types of property",
        [["line", "Line"], ["label", "Type"], ["count", "(b) Number", true], ["amount", "(c) Amount", true], ["method", "(d) Method"]],
        out.rows.map((r) => ({ line: r.line, label: r.description ? `${r.label}: ${r.description}` : r.label, count: r.count, amount: usd(r.amount), method: r.method })),
        { footer: { line: "", label: "Total", count: "", amount: usd(out.total), method: "" } },
      ),
      fields("sched-m-q", "Schedule M lines 29–32", [
        ["Line 29: Forms 8283 received", f.intake.forms8283],
        ["Line 30a: property held three years", f.intake.noncashHeld3Years],
        ["Line 31: gift acceptance policy", f.intake.giftAcceptancePolicy],
        ["Line 32a: third parties used", f.intake.thirdPartyProcessors],
      ]),
    ];
  },
});
