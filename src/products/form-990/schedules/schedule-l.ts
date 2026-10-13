import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { table } from "@/core/render";
import { cents, defineSchedule, usd } from "./common";

/**
 * Schedule L: Transactions With Interested Persons.
 * Part I: excess benefit transactions. Part II: loans. Part III: grants or assistance.
 * Part IV: business transactions.
 */

export const TRANSACTION_KINDS = [
  { value: "excess_benefit", label: "Excess benefit transaction (Part I)" },
  { value: "loan_to", label: "Loan from the organization to the person (Part II)" },
  { value: "loan_from", label: "Loan from the person to the organization (Part II)" },
  { value: "grant", label: "Grant or assistance to the person (Part III)" },
  { value: "business", label: "Business transaction: purchase, lease, or services (Part IV)" },
] as const;

export interface InterestedTransaction {
  kind: (typeof TRANSACTION_KINDS)[number]["value"];
  person: string;
  relationship: string;
  amount: number;
  balanceDue?: number;
  description: string;
  inDefault?: boolean;
  boardApproved?: boolean;
  writtenAgreement?: boolean;
  revenueSharing?: boolean;
  corrected?: boolean;
}

export interface ScheduleLIntake {
  interested?: InterestedTransaction[];
}

export interface ScheduleLOut {
  byPart: Record<"I" | "II" | "III" | "IV", (InterestedTransaction & { amountC: Cents; balanceC: Cents })[]>;
}

const PART: Record<InterestedTransaction["kind"], keyof ScheduleLOut["byPart"]> = {
  excess_benefit: "I",
  loan_to: "II",
  loan_from: "II",
  grant: "III",
  business: "IV",
};

export const scheduleL = defineSchedule<ScheduleLOut>({
  schedule: "L",
  title: "Transactions With Interested Persons",
  intake: [
    {
      title: "Schedule L: transactions with insiders",
      help: "Loans, grants, or business dealings with officers, directors, key employees, substantial contributors, or their family members and businesses.",
      collapsible: true,
      fields: [
        {
          name: "interested",
          type: "list",
          label: "Transactions",
          rows: 3,
          fields: [
            { name: "kind", type: "select", label: "Type", required: true, options: TRANSACTION_KINDS },
            { name: "person", type: "text", label: "Interested person or business", required: true },
            { name: "relationship", type: "text", label: "Relationship to the organization", required: true },
            { name: "amount", type: "money", label: "Amount (original principal for loans) ($)", required: true },
            { name: "balanceDue", type: "money", label: "Loans: balance due at year end ($)" },
            { name: "description", type: "text", label: "Purpose or description", required: true },
            { name: "inDefault", type: "checkbox", label: "Loans: in default" },
            { name: "boardApproved", type: "checkbox", label: "Approved by the board or a committee" },
            { name: "writtenAgreement", type: "checkbox", label: "Written agreement" },
            { name: "revenueSharing", type: "checkbox", label: "Business: shares in the organization's revenues" },
            { name: "corrected", type: "checkbox", label: "Excess benefit: corrected" },
          ],
        },
      ],
    },
  ],

  build(f) {
    const byPart: ScheduleLOut["byPart"] = { I: [], II: [], III: [], IV: [] };
    for (const t of f.intake.interested ?? []) byPart[PART[t.kind]].push({ ...t, amountC: cents(t.amount), balanceC: cents(t.balanceDue) });
    return { byPart };
  },

  rules: [
    {
      id: "l.listed",
      severity: "error",
      ref: "Schedule L",
      description: "Interested-person transactions are listed",
      check: ({ out }) => (Object.values(out.byPart).every((p) => !p.length) ? "The organization reported transactions with interested persons but none are listed" : undefined),
    },
    {
      id: "l.excess_benefit",
      severity: "error",
      ref: "Schedule L, Part I; Form 4720",
      description: "Excess benefit transactions carry excise tax",
      check: ({ out, facts }) =>
        out.byPart.I.length && ["501c3", "501c4"].includes(facts.intake.subsection)
          ? "An excess benefit transaction is reported. Section 4958 excise taxes apply to the disqualified person and approving managers (Form 4720). Confirm with the client and counsel."
          : undefined,
    },
    {
      id: "l.loan_terms",
      severity: "warning",
      ref: "Schedule L, Part II",
      description: "Loans show the balance due and approval",
      check: ({ out }) =>
        out.byPart.II.filter((t) => t.balanceDue === undefined).map((t) => `Enter the year-end balance due on the loan with ${t.person}`),
    },
    {
      id: "l.business_thresholds",
      severity: "info",
      ref: "Schedule L, Part IV instructions",
      description: "Part IV reporting thresholds",
      check: ({ out }) =>
        out.byPart.IV.length
          ? "Part IV reports business transactions only above the thresholds in the instructions (generally over $100,000 in total, or over $10,000 in a single transaction, or over $50,000 with a family member). Remove any below them."
          : undefined,
    },
  ],

  render(out) {
    const s: ReviewSection[] = [];
    const yn = (b?: boolean) => (b ? "Yes" : "No");
    if (out.byPart.I.length)
      s.push(table("sched-l-1", "Schedule L Part I: excess benefit transactions", [["person", "(a) Disqualified person"], ["relationship", "(b) Relationship"], ["description", "(c) Description"], ["corrected", "(d) Corrected"]],
        out.byPart.I.map((t) => ({ person: t.person, relationship: t.relationship, description: t.description, corrected: yn(t.corrected) }))));
    if (out.byPart.II.length)
      s.push(table("sched-l-2", "Schedule L Part II: loans to and from interested persons", [["person", "(a) Name"], ["relationship", "(b) Relationship"], ["description", "(c) Purpose"], ["direction", "(d) Loan to or from"], ["amount", "(e) Original principal", true], ["balance", "(f) Balance due", true], ["default", "(g) In default"], ["approved", "(h) Board approved"], ["written", "(i) Written agreement"]],
        out.byPart.II.map((t) => ({ person: t.person, relationship: t.relationship, description: t.description, direction: t.kind === "loan_to" ? "To" : "From", amount: usd(t.amountC), balance: usd(t.balanceC), default: yn(t.inDefault), approved: yn(t.boardApproved), written: yn(t.writtenAgreement) }))));
    if (out.byPart.III.length)
      s.push(table("sched-l-3", "Schedule L Part III: grants or assistance benefiting interested persons", [["person", "(a) Name"], ["relationship", "(b) Relationship"], ["amount", "(c) Amount", true], ["description", "(d) Type and purpose"]],
        out.byPart.III.map((t) => ({ person: t.person, relationship: t.relationship, amount: usd(t.amountC), description: t.description }))));
    if (out.byPart.IV.length)
      s.push(table("sched-l-4", "Schedule L Part IV: business transactions involving interested persons", [["person", "(a) Name"], ["relationship", "(b) Relationship"], ["amount", "(c) Amount", true], ["description", "(d) Description"], ["sharing", "(e) Shares revenues"]],
        out.byPart.IV.map((t) => ({ person: t.person, relationship: t.relationship, amount: usd(t.amountC), description: t.description, sharing: yn(t.revenueSharing) }))));
    return s.length ? s : [table("sched-l", "Schedule L", [["status", "Status"]], [{ status: "No transactions entered" }])];
  },
});
