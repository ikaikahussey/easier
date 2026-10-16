import { deadline } from "@/core/deadlines";
import { formatUsd } from "@/core/money";
import { laborTask, type LaborTask } from "@/core/pledge";
import { defineProduct, quote, type RuleContext } from "@/core/product";
import { amountTable, fields } from "@/core/render";
import type { Rule } from "@/core/rules";
import { isNettedLine } from "@/domains/nonprofit/lines";
import { lineAmount, lineRows, loadNonprofitLedger, TRIAL_BALANCE, type NonprofitLedger } from "@/domains/nonprofit/ledger";
import { nonprofitLedgerRules } from "@/domains/nonprofit/rules";

/**
 * Augmented Accountants: monthly close for nonprofits. Classifies into the same
 * catalog as Form 990, so the year-end return is a projection of these books.
 */
export interface BooksIntake {
  basis: "accrual" | "cash";
  notes?: string;
}

export interface BooksData {
  basis: BooksIntake["basis"];
  ledger: NonprofitLedger;
}

type Ctx = RuleContext<BooksIntake, BooksData>;

export const BOOKS_MONTHLY_PRICE = 450_00;
/** Accounts assumed before the trial balance is uploaded. */
export const TYPICAL_BOOKS_ACCOUNTS = 60;

/** Hours a human bookkeeper would spend closing one month. Working estimates; refine with time studies. */
export function booksLabor(accounts: number): LaborTask[] {
  return [
    laborTask("Collect and import the month's ledger", 0.5),
    laborTask(`Review and classify ${accounts} accounts (2 min each)`, 0, 1 / 30, accounts),
    laborTask("Reconciliation checks and tie-out", 1.5),
    laborTask("Prepare statements of activities and financial position", 1),
    laborTask("Close notes for the board", 0.5),
  ];
}

const rules: Rule<Ctx>[] = [
  ...nonprofitLedgerRules<Ctx>((c) => c.data.ledger),
  {
    id: "books.negative_cash",
    severity: "warning",
    description: "Cash accounts do not carry credit balances",
    check: ({ data }) =>
      data.ledger.tb.accounts
        .filter((a) => a.type === "asset" && /cash|checking|savings/i.test(a.name) && a.balance < 0)
        .map((a) => ({ message: `"${a.name}" is negative (${formatUsd(a.balance)}); check for unrecorded deposits or overdraft`, subject: a.id })),
  },
  {
    id: "books.other_expense_share",
    severity: "warning",
    description: "Other expenses stay under 10% of total expenses",
    check: ({ data }) => {
      const other = lineAmount(data.ledger, "IX.24");
      const total = data.ledger.totals.functionalExpenses;
      return total > 0 && other / total > 0.1
        ? `Other expenses are ${Math.round((other / total) * 100)}% of the total; reclassify to specific lines`
        : undefined;
    },
  },
];

export const books = defineProduct<BooksIntake, BooksData>({
  slug: "books",
  line: "Easier Books",
  name: "Monthly close (Augmented Accountants)",
  tagline: "Nonprofit books closed every month, reviewed by an accountant, ready for your board and your 990.",
  status: "beta",
  reviewerCredentials: ["CPA", "EA", "Senior accountant"],
  consents: ["engagement_letter"],
  period: { name: "period", type: "date", label: "Month-end date", required: true },
  intake: [
    {
      title: "Close settings",
      fields: [
        {
          name: "basis",
          type: "select",
          label: "Accounting basis",
          required: true,
          options: [
            { value: "accrual", label: "Accrual" },
            { value: "cash", label: "Cash" },
          ],
        },
        { name: "notes", type: "textarea", label: "Anything unusual this month?" },
      ],
    },
  ],
  documents: [{ ...TRIAL_BALANCE, label: "Year-to-date trial balance (CSV)" }],
  // Service-level target: financials delivered by the 15th of the following month.
  deadline: (period) => deadline(period, { months: 1, day: 15 }),
  quote: () => quote("Monthly", [{ label: "Monthly close and financial statements", cents: BOOKS_MONTHLY_PRICE }]),
  labor: (_intake, data) => booksLabor(data?.ledger.tb.accounts.length ?? TYPICAL_BOOKS_ACCOUNTS),

  async build(input, ai) {
    const { ledger, editable } = await loadNonprofitLedger(input, ai);
    return { data: { basis: input.intake.basis, ledger }, editable };
  },
  rules,
  render: ({ ledger, basis }) => {
    const t = ledger.totals;
    return [
      fields("summary", "Summary", [
        ["Basis", basis === "accrual" ? "Accrual" : "Cash"],
        ["Revenue (year to date)", formatUsd(t.grossRevenue - t.nettedExpenses)],
        ["Expenses (year to date)", formatUsd(t.functionalExpenses)],
        ["Change in net assets", formatUsd(t.grossRevenue - t.nettedExpenses - t.functionalExpenses)],
        ["Total assets", formatUsd(t.assets)],
        ["Net assets", formatUsd(t.endingNetAssets)],
      ]),
      amountTable("activities-revenue", "Statement of Activities — Revenue", [
        ...lineRows(ledger, "revenue"),
        ...lineRows(ledger, "expense", isNettedLine).map((r) => ({ ...r, label: `Less: ${r.label}`, amount: -r.amount })),
      ], "Total revenue"),
      amountTable("activities-expenses", "Statement of Activities — Expenses", lineRows(ledger, "expense", (c) => !isNettedLine(c)), "Total expenses"),
      amountTable("position-assets", "Statement of Financial Position — Assets", lineRows(ledger, "asset"), "Total assets"),
      amountTable("position-liabilities", "Statement of Financial Position — Liabilities", lineRows(ledger, "liability"), "Total liabilities"),
    ];
  },
});
