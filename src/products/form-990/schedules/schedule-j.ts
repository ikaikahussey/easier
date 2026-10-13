import type { Cents } from "@/core/money";
import { fields, table } from "@/core/render";
import { cents, defineSchedule, TIE, usd } from "./common";

/**
 * Schedule J: Compensation Information, for officers, directors, trustees, key
 * employees, and highest compensated employees with reportable compensation over
 * $150,000 (or former officers). Part I: policies. Part II: compensation breakdown.
 */

export const FRINGE_ITEMS = [
  { name: "jFirstClassTravel", label: "First-class or charter travel" },
  { name: "jCompanionTravel", label: "Travel for companions" },
  { name: "jTaxGrossUp", label: "Tax indemnification and gross-up payments" },
  { name: "jDiscretionaryAccount", label: "Discretionary spending account" },
  { name: "jHousing", label: "Housing allowance or residence for personal use" },
  { name: "jHomeOffice", label: "Payments for business use of personal residence" },
  { name: "jClubDues", label: "Health or social club dues or initiation fees" },
  { name: "jPersonalServices", label: "Personal services (maid, chauffeur, chef)" },
] as const;

export const COMP_METHODS = [
  { name: "jCompCommittee", label: "Compensation committee" },
  { name: "jConsultant", label: "Independent compensation consultant" },
  { name: "jPeerReturns", label: "Form 990 of other organizations" },
  { name: "jContract", label: "Written employment contract" },
  { name: "jSurvey", label: "Compensation survey or study" },
  { name: "jBoardApproval", label: "Approval by the board or compensation committee" },
] as const;

type Flags = Partial<Record<(typeof FRINGE_ITEMS)[number]["name"] | (typeof COMP_METHODS)[number]["name"], boolean>>;

export interface ScheduleJIntake extends Flags {
  jWrittenPolicy?: boolean;
  jSubstantiation?: boolean;
  jSeverance?: boolean;
  jSupplementalRetirement?: boolean;
  jEquityComp?: boolean;
  jRevenueContingent?: boolean;
  jNonFixedPayments?: boolean;
  jRebuttablePresumption?: boolean;
  compensated?: { name: string; title: string; base: number; bonus?: number; other?: number; deferred?: number; nontaxable?: number; priorDeferred?: number }[];
}

export interface ScheduleJPerson {
  name: string;
  title: string;
  base: Cents;
  bonus: Cents;
  other: Cents;
  deferred: Cents;
  nontaxable: Cents;
  total: Cents;
  priorDeferred: Cents;
}

export interface ScheduleJOut {
  fringe: string[];
  methods: string[];
  people: ScheduleJPerson[];
  /** Officers in Part VII with reportable compensation over $150,000. */
  partVIIOver150k: { name: string; compensation: Cents }[];
}

const THRESHOLD = 150_000_00;

export const scheduleJ = defineSchedule<ScheduleJOut>({
  schedule: "J",
  title: "Compensation Information",
  intake: [
    {
      title: "Schedule J: compensation over $150,000",
      help: "For each person who received more than $150,000 in reportable compensation. Amounts come from the W-2 (box 5) or 1099.",
      collapsible: true,
      fields: [
        ...FRINGE_ITEMS.map((x) => ({ name: x.name, type: "checkbox" as const, label: `Provided: ${x.label}` })),
        { name: "jWrittenPolicy", type: "yesno", label: "If any of the above were provided: is there a written policy on payment or reimbursement?" },
        { name: "jSubstantiation", type: "yesno", label: "Does the organization require substantiation before reimbursing expenses of officers and directors?" },
        ...COMP_METHODS.map((x) => ({ name: x.name, type: "checkbox" as const, label: `Used to set the CEO's compensation: ${x.label}` })),
        { name: "jSeverance", type: "yesno", label: "Did anyone listed receive a severance or change-of-control payment?" },
        { name: "jSupplementalRetirement", type: "yesno", label: "Did anyone listed participate in a supplemental nonqualified retirement plan?" },
        { name: "jEquityComp", type: "yesno", label: "Did anyone listed participate in an equity-based compensation arrangement?" },
        { name: "jRevenueContingent", type: "yesno", label: "Was any compensation contingent on the revenues or net earnings of the organization or a related organization?" },
        { name: "jNonFixedPayments", type: "yesno", label: "Did anyone listed receive any non-fixed payments not described above?" },
        { name: "jRebuttablePresumption", type: "yesno", label: "Were any payments made under the rebuttable presumption procedure (Treas. Reg. 53.4958-6(c))?" },
        {
          name: "compensated",
          type: "list",
          label: "People with compensation over $150,000",
          rows: 3,
          fields: [
            { name: "name", type: "text", label: "Name", required: true },
            { name: "title", type: "text", label: "Title", required: true },
            { name: "base", type: "money", label: "Base compensation ($)", required: true },
            { name: "bonus", type: "money", label: "Bonus and incentive compensation ($)" },
            { name: "other", type: "money", label: "Other reportable compensation ($)" },
            { name: "deferred", type: "money", label: "Retirement and other deferred compensation ($)" },
            { name: "nontaxable", type: "money", label: "Nontaxable benefits ($)" },
            { name: "priorDeferred", type: "money", label: "Compensation reported as deferred on a prior Form 990 ($)" },
          ],
        },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    return {
      fringe: FRINGE_ITEMS.filter((x) => i[x.name]).map((x) => x.label),
      methods: COMP_METHODS.filter((x) => i[x.name]).map((x) => x.label),
      people: (i.compensated ?? []).map((p) => {
        const base = cents(p.base), bonus = cents(p.bonus), other = cents(p.other), deferred = cents(p.deferred), nontaxable = cents(p.nontaxable);
        return { name: p.name, title: p.title, base, bonus, other, deferred, nontaxable, total: base + bonus + other + deferred + nontaxable, priorDeferred: cents(p.priorDeferred) };
      }),
      partVIIOver150k: i.officers.map((o) => ({ name: o.name, compensation: cents(o.compensation) })).filter((o) => o.compensation > THRESHOLD),
    };
  },

  rules: [
    {
      id: "j.people_listed",
      severity: "error",
      ref: "Schedule J, Part II",
      description: "Everyone over $150,000 is broken out",
      check: ({ out }) => {
        const listed = new Set(out.people.map((p) => p.name.trim().toLowerCase()));
        const missing = out.partVIIOver150k.filter((o) => !listed.has(o.name.trim().toLowerCase()));
        if (!out.people.length) return "List each person with reportable compensation over $150,000";
        return missing.map((o) => `${o.name} has ${usd(o.compensation)} in Part VII but no Schedule J breakdown`);
      },
    },
    {
      id: "j.ties_to_part_vii",
      severity: "warning",
      ref: "Schedule J column B vs Part VII column D",
      description: "Reportable compensation agrees with Part VII",
      check: ({ out }) =>
        out.people.flatMap((p) => {
          const o = out.partVIIOver150k.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
          const reportable = p.base + p.bonus + p.other;
          return o && Math.abs(o.compensation - reportable) > TIE
            ? [`${p.name}: Schedule J reportable compensation ${usd(reportable)} differs from Part VII ${usd(o.compensation)}`]
            : [];
        }),
    },
    {
      id: "j.method",
      severity: "warning",
      ref: "Schedule J, Part I line 3",
      description: "At least one method used to set CEO compensation",
      check: ({ out }) => (out.methods.length ? undefined : "No method for setting the CEO's compensation was checked; the IRS expects at least one"),
    },
    {
      id: "j.fringe_policy",
      severity: "error",
      ref: "Schedule J, Part I line 1b",
      description: "Fringe items require an answer on the written policy",
      check: ({ out, facts }) =>
        out.fringe.length && facts.intake.jWrittenPolicy === undefined ? "Answer whether there is a written policy covering the fringe items checked" : undefined,
    },
    {
      id: "j.explanations",
      severity: "info",
      ref: "Schedule J, Part III",
      description: "Yes answers on lines 1a and 4–8 are explained",
      check: ({ out, facts }) => {
        const i = facts.intake;
        return out.fringe.length || i.jSeverance || i.jSupplementalRetirement || i.jEquityComp || i.jRevenueContingent || i.jNonFixedPayments
          ? "Describe each Yes answer and the amounts involved in Part III"
          : undefined;
      },
    },
  ],

  render(out, f) {
    const i = f.intake;
    return [
      fields("sched-j-1", "Schedule J Part I: compensation practices", [
        ["Line 1a: fringe items provided", out.fringe.join("; ") || "None"],
        ["Line 1b: written policy", i.jWrittenPolicy],
        ["Line 2: substantiation required", i.jSubstantiation],
        ["Line 3: methods used for CEO compensation", out.methods.join("; ") || "None"],
        ["Line 4a: severance or change-of-control payment", i.jSeverance],
        ["Line 4b: supplemental nonqualified retirement plan", i.jSupplementalRetirement],
        ["Line 4c: equity-based compensation", i.jEquityComp],
        ["Lines 5–6: compensation contingent on revenues or earnings", i.jRevenueContingent],
        ["Line 7: non-fixed payments", i.jNonFixedPayments],
        ["Line 9: rebuttable presumption procedure", i.jRebuttablePresumption],
      ]),
      table(
        "sched-j-2",
        "Schedule J Part II: compensation (from the organization)",
        [["name", "(A) Name and title"], ["base", "(B)(i) Base", true], ["bonus", "(B)(ii) Bonus", true], ["other", "(B)(iii) Other", true], ["deferred", "(C) Deferred", true], ["nontaxable", "(D) Nontaxable benefits", true], ["total", "(E) Total", true], ["prior", "(F) Reported as deferred before", true]],
        out.people.map((p) => ({ name: `${p.name}, ${p.title}`, base: usd(p.base), bonus: usd(p.bonus), other: usd(p.other), deferred: usd(p.deferred), nontaxable: usd(p.nontaxable), total: usd(p.total), prior: usd(p.priorDeferred) })),
        { note: "Compensation from related organizations (row ii) is not collected; add it if any related organization paid these people." },
      ),
    ];
  },
});
