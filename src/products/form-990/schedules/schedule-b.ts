import type { Cents } from "@/core/money";
import { fields, table } from "@/core/render";
import { amt, cents, CONTRIBUTION_LINES, defineSchedule, TIE, usd } from "./common";
import type { ScheduleAOut } from "./schedule-a";

/**
 * Schedule B: Schedule of Contributors. General rule: every contributor of $5,000 or
 * more. Special rule for 501(c)(3) organizations that meet the 33⅓% test in Schedule A
 * Part II (lines 13, 16a, or 16b): only contributors of more than the greater of
 * $5,000 or 2% of total contributions (Form 990 Part VIII line 1h / 990-EZ line 1).
 */

export const CONTRIBUTOR_KINDS = [
  { value: "individual", label: "Individual" },
  { value: "business", label: "Business" },
  { value: "foundation", label: "Private foundation or donor-advised fund" },
  { value: "public_charity", label: "Public charity" },
  { value: "government", label: "Government agency" },
] as const;

export interface Contributor {
  name: string;
  address?: string;
  kind: (typeof CONTRIBUTOR_KINDS)[number]["value"];
  amount: number;
  noncash?: number;
  noncashDescription?: string;
  noncashDate?: string;
  payroll?: boolean;
  fiveYearTotal?: number;
}

export interface ScheduleBIntake {
  contributors?: Contributor[];
}

export interface ScheduleBOut {
  rule: "general" | "special";
  threshold: Cents;
  /** Total contributions, Part VIII line 1h. */
  line1h: Cents;
  listed: {
    no: number;
    name: string;
    address?: string;
    total: Cents;
    person: boolean;
    payroll: boolean;
    noncash: Cents;
    noncashDescription?: string;
    noncashDate?: string;
  }[];
  /** Contributions entered by the client, for reconciliation with the ledger. */
  entered: Cents;
}

export const scheduleB = defineSchedule<ScheduleBOut>({
  schedule: "B",
  title: "Schedule of Contributors",
  intake: [
    {
      title: "Contributors of $5,000 or more",
      help: "Everyone who gave $5,000 or more this year, in cash or property. Names and addresses are sent to the IRS but are not made public for 501(c)(3) organizations. Government grants are listed here too, so the support test can tell them apart, but they are not reported on Schedule B.",
      collapsible: true,
      fields: [
        {
          name: "contributors",
          type: "list",
          label: "Contributors",
          rows: 10,
          fields: [
            { name: "name", type: "text", label: "Name", required: true },
            { name: "address", type: "text", label: "Address" },
            {
              name: "kind",
              type: "select",
              label: "Type of contributor",
              required: true,
              options: CONTRIBUTOR_KINDS,
            },
            { name: "amount", type: "money", label: "Total given this year, cash and property ($)", required: true },
            { name: "noncash", type: "money", label: "Of which property or in-kind, at fair market value ($)" },
            { name: "noncashDescription", type: "text", label: "Description of property" },
            { name: "noncashDate", type: "date", label: "Date property received" },
            { name: "payroll", type: "checkbox", label: "Given through payroll deduction" },
            { name: "fiveYearTotal", type: "money", label: "501(c)(3) only: total given over this year and the prior four ($)" },
          ],
        },
      ],
    },
  ],

  build(f) {
    const line1h = amt(f, ...CONTRIBUTION_LINES);
    const a = f.outputs.A as ScheduleAOut | undefined;
    const special = f.intake.subsection === "501c3" && ["13", "16a", "16b"].includes(a?.partII?.result ?? "");
    const threshold = special ? Math.max(5_000_00, Math.round(line1h * 0.02)) : 5_000_00;
    const qualifies = (c: Cents) => (special ? c > threshold : c >= threshold);
    const contributors = f.intake.contributors ?? [];
    const listed = contributors
      .filter((c) => c.kind !== "government" && qualifies(cents(c.amount)))
      .map((c, idx) => {
        const total = cents(c.amount);
        const noncash = Math.min(total, cents(c.noncash));
        return {
          no: idx + 1,
          name: c.name,
          address: c.address,
          total,
          person: total - noncash > 0 && !c.payroll,
          payroll: !!c.payroll,
          noncash,
          noncashDescription: c.noncashDescription,
          noncashDate: c.noncashDate,
        };
      });
    return {
      rule: special ? "special" : "general",
      threshold,
      line1h,
      listed,
      entered: contributors.reduce((t, c) => t + cents(c.amount), 0),
    };
  },

  rules: [
    {
      id: "b.none_listed",
      severity: "error",
      ref: "Schedule B, Part I",
      description: "Contributors are listed when the organization reported a $5,000 donor",
      check: ({ out, facts }) =>
        facts.intake.contributorOver5000 && out.listed.length === 0
          ? out.rule === "special"
            ? `No contributor exceeds the special-rule threshold of ${usd(out.threshold)}. Confirm and answer Part IV line 2 "No", or list the contributors.`
            : "The organization reported a donor of $5,000 or more but no contributor is listed"
          : undefined,
    },
    {
      id: "b.exceeds_ledger",
      severity: "warning",
      ref: "Part VIII, line 1h",
      description: "Listed contributions do not exceed total contributions in the books",
      check: ({ out }) =>
        out.entered - out.line1h > TIE
          ? `Contributors entered total ${usd(out.entered)}, more than total contributions of ${usd(out.line1h)} in the books`
          : undefined,
    },
    {
      id: "b.noncash_details",
      severity: "error",
      ref: "Schedule B, Part II",
      description: "Noncash contributions are described with a date received",
      check: ({ out }) =>
        out.listed
          .filter((c) => c.noncash > 0 && (!c.noncashDescription || !c.noncashDate))
          .map((c) => `Describe the property from ${c.name} and the date received`),
    },
    {
      id: "b.address",
      severity: "warning",
      ref: "Schedule B, Part I, column (b)",
      description: "Listed contributors have an address",
      check: ({ out }) => out.listed.filter((c) => !c.address).map((c) => `Add an address for ${c.name}`),
    },
  ],

  render(out) {
    const rows = out.listed.map((c) => ({
      no: c.no,
      name: c.name,
      address: c.address ?? "—",
      total: usd(c.total),
      type: [c.person && "Person", c.payroll && "Payroll", c.noncash > 0 && "Noncash"].filter(Boolean).join(", "),
    }));
    const noncash = out.listed.filter((c) => c.noncash > 0);
    return [
      fields("sched-b-rule", "Schedule B: filing rule", [
        ["Rule", out.rule === "special" ? "Special rule for 33⅓% publicly supported 501(c)(3) organizations" : "General rule"],
        ["Listing threshold", out.rule === "special" ? `More than ${usd(out.threshold)}` : `${usd(out.threshold)} or more`],
        ["Total contributions (Part VIII line 1h)", usd(out.line1h)],
      ]),
      table(
        "sched-b-1",
        "Schedule B Part I: contributors",
        [["no", "No."], ["name", "Name"], ["address", "Address"], ["total", "Total contributions", true], ["type", "Type"]],
        rows,
        { note: "Not open to public inspection for 501(c)(3) organizations; the public copy omits names and addresses." },
      ),
      ...(noncash.length
        ? [
            table(
              "sched-b-2",
              "Schedule B Part II: noncash property",
              [["no", "No. from Part I"], ["description", "Description"], ["fmv", "Fair market value", true], ["date", "Date received"]],
              noncash.map((c) => ({ no: c.no, description: c.noncashDescription ?? "—", fmv: usd(c.noncash), date: c.noncashDate ?? "—" })),
            ),
          ]
        : []),
    ];
  },
});
