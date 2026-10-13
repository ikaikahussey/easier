import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { cents, defineSchedule, usd, yesNo } from "./common";

/**
 * Schedule N: Liquidation, Termination, Dissolution, or Significant Disposition
 * of Assets. Part I for a final return; Part II for a disposition of more than
 * 25% of net assets. Both list each distribution of assets.
 */

export interface AssetDistribution {
  description: string;
  date: string;
  fairMarketValue: number;
  method: string;
  recipient: string;
  recipientEin?: string;
  recipientSection?: string;
}

export interface ScheduleNIntake {
  distributions?: AssetDistribution[];
  nOfficerBecameInsider?: boolean;
  nOfficerEmployee?: boolean;
  nOfficerOwner?: boolean;
  nOfficerCompensated?: boolean;
  nInsiderExplanation?: string;
  nNotifiedState?: boolean;
  nLiabilitiesPaid?: boolean;
  nBondsOutstanding?: boolean;
  nBondsDischarged?: boolean;
  nSuccessor?: string;
}

export interface ScheduleNOut {
  part: "I" | "II";
  distributions: (Omit<AssetDistribution, "fairMarketValue"> & { fmv: Cents })[];
  total: Cents;
  /** Net assets at the beginning of the year, to judge the 25% test. */
  beginningNetAssets: Cents;
  pctOfNetAssets: number;
}

export const scheduleN = defineSchedule<ScheduleNOut>({
  schedule: "N",
  title: "Liquidation, Termination, Dissolution, or Significant Disposition of Assets",
  intake: [
    {
      title: "Schedule N: termination or major disposition of assets",
      help: "Complete if this is a final return or the organization disposed of more than 25% of its net assets (sales, transfers, or distributions outside the ordinary course).",
      collapsible: true,
      fields: [
        {
          name: "distributions",
          type: "list",
          label: "Assets distributed, transferred, or sold",
          rows: 5,
          fields: [
            { name: "description", type: "text", label: "Description of assets", required: true },
            { name: "date", type: "date", label: "Date of distribution", required: true },
            { name: "fairMarketValue", type: "money", label: "Fair market value ($)", required: true },
            { name: "method", type: "text", label: "Method of determining fair market value", required: true },
            { name: "recipient", type: "text", label: "Recipient name and address", required: true },
            { name: "recipientEin", type: "text", label: "Recipient EIN" },
            { name: "recipientSection", type: "text", label: "Recipient's IRC section, if tax-exempt" },
          ],
        },
        { name: "nOfficerBecameInsider", type: "yesno", label: "Did or will any officer, director, trustee, or key employee become a director or trustee of a successor or transferee organization?" },
        { name: "nOfficerEmployee", type: "yesno", label: "Become an employee of, or independent contractor for, a successor or transferee?" },
        { name: "nOfficerOwner", type: "yesno", label: "Become a direct or indirect owner of a successor or transferee?" },
        { name: "nOfficerCompensated", type: "yesno", label: "Receive, or become entitled to, compensation or other similar payments as a result of the transaction?" },
        { name: "nInsiderExplanation", type: "textarea", label: "If yes to any of the above: explain" },
        { name: "nNotifiedState", type: "yesno", label: "Final return only: did the organization notify the state attorney general or other appropriate state official of its intent to dissolve?" },
        { name: "nLiabilitiesPaid", type: "yesno", label: "Final return only: were all liabilities paid or discharged, or provided for?" },
        { name: "nBondsOutstanding", type: "yesno", label: "Final return only: did it have tax-exempt bonds outstanding?" },
        { name: "nBondsDischarged", type: "yesno", label: "If so: were the bonds discharged or defeased?" },
        { name: "nSuccessor", type: "text", label: "Successor or transferee organization, if any" },
      ],
    },
  ],

  build(f) {
    const distributions = (f.intake.distributions ?? []).map(({ fairMarketValue, ...d }) => ({ ...d, fmv: cents(fairMarketValue) }));
    const total = distributions.reduce((t, d) => t + d.fmv, 0);
    const beginningNetAssets = f.ledger.totals.beginningNetAssets;
    return {
      part: f.intake.finalReturn ? "I" : "II",
      distributions,
      total,
      beginningNetAssets,
      pctOfNetAssets: beginningNetAssets ? Math.round((total / beginningNetAssets) * 1000) / 10 : 0,
    };
  },

  rules: [
    {
      id: "n.listed",
      severity: "error",
      ref: "Schedule N, line 1",
      description: "Distributed assets are listed",
      check: ({ out }) => (out.distributions.length ? undefined : "List each asset distributed, transferred, or sold with its fair market value and recipient"),
    },
    {
      id: "n.insider_questions",
      severity: "error",
      ref: "Schedule N, lines 2a–2e",
      description: "Insider questions are answered and explained",
      check: ({ facts: { intake: i } }) => {
        if ([i.nOfficerBecameInsider, i.nOfficerEmployee, i.nOfficerOwner, i.nOfficerCompensated].some((v) => v === undefined)) return "Answer Schedule N lines 2a–2d about officers and the successor organization";
        if ((i.nOfficerBecameInsider || i.nOfficerEmployee || i.nOfficerOwner || i.nOfficerCompensated) && !i.nInsiderExplanation) return "Explain the officer involvement with the successor (line 2e)";
      },
    },
    {
      id: "n.final_return_questions",
      severity: "error",
      ref: "Schedule N, Part I lines 3–7",
      description: "Final returns answer the dissolution questions",
      check: ({ out, facts: { intake: i } }) =>
        out.part === "I" && [i.nNotifiedState, i.nLiabilitiesPaid, i.nBondsOutstanding].some((v) => v === undefined)
          ? "Answer the Part I dissolution questions: state notification, liabilities discharged, bonds outstanding"
          : undefined,
    },
    {
      id: "n.distribution_to_insiders",
      severity: "warning",
      ref: "Schedule N",
      description: "Charitable assets go to charitable recipients",
      check: ({ out, facts }) =>
        facts.intake.subsection === "501c3"
          ? out.distributions.filter((d) => !d.recipientSection).map((d) => `Recipient "${d.recipient}" has no exempt section; 501(c)(3) assets must go to another 501(c)(3) or a government on dissolution`)
          : undefined,
    },
    {
      id: "n.below_25",
      severity: "info",
      ref: "Form 990 Part IV, line 32",
      description: "Part II applies above 25% of net assets",
      check: ({ out }) =>
        out.part === "II" && out.beginningNetAssets > 0 && out.pctOfNetAssets <= 25
          ? `Dispositions total ${out.pctOfNetAssets}% of beginning net assets; Schedule N Part II is required only above 25%`
          : undefined,
    },
  ],

  render(out, f) {
    const i = f.intake;
    const s: ReviewSection[] = [
      table(
        "sched-n-1",
        `Schedule N Part ${out.part}, line 1: assets distributed, transferred, or sold`,
        [["description", "(a) Description"], ["date", "(b) Date"], ["fmv", "(c) Fair market value", true], ["method", "(d) Method"], ["recipient", "(e) Recipient"], ["ein", "(e) EIN"], ["section", "(f) IRC section"]],
        out.distributions.map((d) => ({ description: d.description, date: d.date, fmv: usd(d.fmv), method: d.method, recipient: d.recipient, ein: d.recipientEin ?? "—", section: d.recipientSection ?? "—" })),
        { footer: { description: "Total", date: "", fmv: usd(out.total), method: "", recipient: out.beginningNetAssets ? `${out.pctOfNetAssets}% of beginning net assets` : "", ein: "", section: "" } },
      ),
      fields(`sched-n-q`, `Schedule N Part ${out.part}, lines 2–7`, [
        ["2a Officer became a director or trustee of a successor", yesNo(i.nOfficerBecameInsider)],
        ["2b Officer became an employee or contractor of a successor", yesNo(i.nOfficerEmployee)],
        ["2c Officer became an owner of a successor", yesNo(i.nOfficerOwner)],
        ["2d Officer received compensation from the transaction", yesNo(i.nOfficerCompensated)],
        ["2e Explanation", i.nInsiderExplanation],
        ...(out.part === "I"
          ? ([
              ["3 State official notified", yesNo(i.nNotifiedState)],
              ["4 Liabilities paid or discharged", yesNo(i.nLiabilitiesPaid)],
              ["5 Tax-exempt bonds outstanding", yesNo(i.nBondsOutstanding)],
              ["6 Bonds discharged or defeased", i.nBondsOutstanding ? yesNo(i.nBondsDischarged) : "—"],
              ["Successor organization", i.nSuccessor],
            ] as [string, string | undefined][])
          : []),
      ]),
    ];
    return s;
  },
});
