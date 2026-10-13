import type { Cents } from "@/core/money";
import { fields } from "@/core/render";
import { amt, cents, defineSchedule, TIE, usd, yesNo } from "../schedules/common";

/**
 * Form 990 Part XI (Reconciliation of Net Assets) and Part XII (Financial
 * Statements and Reporting). Line 10 must equal Part X line 32 column (B), which
 * is total assets less total liabilities from the trial balance.
 */

export const STATEMENT_BASIS = [
  { value: "separate", label: "Separate basis" },
  { value: "consolidated", label: "Consolidated basis" },
  { value: "both", label: "Both consolidated and separate basis" },
] as const;

export interface PartXIIntake {
  netUnrealizedGains?: number;
  donatedServicesValue?: number;
  investmentExpensesNetted?: number;
  priorPeriodAdjustments?: number;
  otherNetAssetChanges?: number;
  otherNetAssetChangesDescription?: string;
  compiledOrReviewed?: boolean;
  statementBasis?: (typeof STATEMENT_BASIS)[number]["value"];
  auditCommittee?: boolean;
  singleAuditRequired?: boolean;
  singleAuditCompleted?: boolean;
}

export interface PartXIOut {
  line1: Cents;
  line2: Cents;
  line3: Cents;
  line4: Cents;
  line5: Cents;
  line6: Cents;
  line7: Cents;
  line8: Cents;
  line9: Cents;
  line10: Cents;
  /** Part X line 32 column (B): assets less liabilities per the trial balance. */
  partX32: Cents;
  difference: Cents;
  federalAwards: Cents;
}

/** Uniform Guidance single-audit threshold for fiscal years beginning on or after October 1, 2024. */
export const SINGLE_AUDIT_THRESHOLD = 1_000_000_00;

export const partXI = defineSchedule<PartXIOut>({
  schedule: "XI",
  title: "Reconciliation of Net Assets and Financial Statements",
  intake: [
    {
      title: "Net assets and financial statements",
      help: "Form 990 Parts XI and XII. Leave the adjustments blank unless the books record them outside revenue and expenses.",
      collapsible: true,
      fields: [
        { name: "netUnrealizedGains", type: "money", label: "Net unrealized gains (losses) on investments recorded directly in net assets ($; negative for losses)", min: -1e12 },
        { name: "donatedServicesValue", type: "money", label: "Donated services and use of facilities recorded in net assets ($)" },
        { name: "investmentExpensesNetted", type: "money", label: "Investment expenses netted against revenue in the books ($)" },
        { name: "priorPeriodAdjustments", type: "money", label: "Prior period adjustments ($; negative to reduce)", min: -1e12 },
        { name: "otherNetAssetChanges", type: "money", label: "Other changes in net assets not in revenue or expenses ($; negative to reduce)", min: -1e12 },
        { name: "otherNetAssetChangesDescription", type: "text", label: "Describe other changes (reported on Schedule O)" },
        { name: "compiledOrReviewed", type: "yesno", label: "Were the financial statements compiled or reviewed by an independent accountant? (Part XII line 2a)" },
        { name: "statementBasis", type: "select", label: "If compiled, reviewed, or audited: basis of the statements", options: STATEMENT_BASIS },
        { name: "auditCommittee", type: "yesno", label: "Does a committee oversee the audit, review, or compilation and select the accountant? (line 2c)" },
        { name: "singleAuditRequired", type: "yesno", label: "Was a Single Audit required under the Uniform Guidance (2 CFR 200 Subpart F) because of federal awards? (line 3a)" },
        { name: "singleAuditCompleted", type: "yesno", label: "If so: was the audit completed? (line 3b)" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const line1 = f.ledger.totals.grossRevenue - f.ledger.totals.nettedExpenses;
    const line2 = f.totalExpenses;
    const line4 = f.ledger.totals.beginningNetAssets;
    const line5 = cents(i.netUnrealizedGains);
    const line6 = cents(i.donatedServicesValue);
    const line7 = cents(i.investmentExpensesNetted);
    const line8 = cents(i.priorPeriodAdjustments);
    const line9 = cents(i.otherNetAssetChanges);
    const line3 = line1 - line2;
    const line10 = line3 + line4 + line5 + line6 + line7 + line8 + line9;
    const partX32 = f.ledger.totals.assets - f.ledger.totals.liabilities;
    return { line1, line2, line3, line4, line5, line6, line7, line8, line9, line10, partX32, difference: partX32 - line10, federalAwards: amt(f, "VIII.1e") };
  },

  rules: [
    {
      id: "xi.reconciles",
      severity: "error",
      ref: "Part XI, line 10 vs Part X, line 32",
      description: "Net assets reconcile to the balance sheet",
      check: ({ out }) =>
        Math.abs(out.difference) > TIE
          ? `Part XI line 10 is ${usd(out.line10)} but assets less liabilities is ${usd(out.partX32)}: ${usd(out.difference)} unexplained. Record it on lines 5–9 or correct the trial balance.`
          : undefined,
    },
    {
      id: "xi.other_described",
      severity: "error",
      ref: "Part XI, line 9",
      description: "Other changes in net assets are described on Schedule O",
      check: ({ out, facts }) => (out.line9 !== 0 && !facts.intake.otherNetAssetChangesDescription ? "Describe the other changes in net assets (line 9) for Schedule O" : undefined),
    },
    {
      id: "xii.answered",
      severity: "error",
      ref: "Part XII",
      description: "Financial statement questions are answered",
      check: ({ facts: { intake: i } }) =>
        [
          i.compiledOrReviewed === undefined && "Line 2a: answer whether statements were compiled or reviewed",
          (i.compiledOrReviewed || i.auditedFinancials) && !i.statementBasis && "Line 2a/2b: give the basis of the financial statements",
          (i.compiledOrReviewed || i.auditedFinancials) && i.auditCommittee === undefined && "Line 2c: answer whether a committee oversees the audit or review",
          i.singleAuditRequired === undefined && "Line 3a: answer whether a Single Audit was required",
          i.singleAuditRequired && i.singleAuditCompleted === undefined && "Line 3b: answer whether the Single Audit was completed",
        ].filter((m): m is string => !!m),
    },
    {
      id: "xii.single_audit",
      severity: "warning",
      ref: "Part XII, line 3a",
      description: "Federal awards at or above the Single Audit threshold",
      check: ({ out, facts }) =>
        out.federalAwards >= SINGLE_AUDIT_THRESHOLD && !facts.intake.singleAuditRequired
          ? `Government grants of ${usd(out.federalAwards)} are at or above the $1,000,000 Single Audit threshold; confirm whether the awards were federal and a Single Audit was required`
          : undefined,
    },
  ],

  render(out, f) {
    const i = f.intake;
    return [
      fields("part-xi", "Part XI: Reconciliation of Net Assets", [
        ["1 Total revenue (Part VIII line 12)", usd(out.line1)],
        ["2 Total expenses (Part IX line 25)", usd(out.line2)],
        ["3 Revenue less expenses", usd(out.line3)],
        ["4 Net assets at beginning of year (Part X line 32, column A)", usd(out.line4)],
        ["5 Net unrealized gains (losses) on investments", usd(out.line5)],
        ["6 Donated services and use of facilities", usd(out.line6)],
        ["7 Investment expenses", usd(out.line7)],
        ["8 Prior period adjustments", usd(out.line8)],
        ["9 Other changes in net assets (Schedule O)", usd(out.line9)],
        ["10 Net assets at end of year (must equal Part X line 32, column B)", usd(out.line10)],
        ["Part X line 32, column B (assets less liabilities)", usd(out.partX32)],
      ]),
      fields("part-xii", "Part XII: Financial Statements and Reporting", [
        ["1 Accounting method", i.accountingMethod],
        ["2a Compiled or reviewed by an independent accountant", yesNo(i.compiledOrReviewed)],
        ["2b Audited by an independent accountant", yesNo(i.auditedFinancials)],
        ["Basis", STATEMENT_BASIS.find((b) => b.value === i.statementBasis)?.label],
        ["2c Committee oversees the audit or review and selects the accountant", yesNo(i.auditCommittee)],
        ["3a Single Audit required (Uniform Guidance)", yesNo(i.singleAuditRequired)],
        ["3b Single Audit completed", i.singleAuditRequired ? yesNo(i.singleAuditCompleted) : "—"],
      ]),
    ];
  },
});
