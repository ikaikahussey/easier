import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { amt, cents, defineSchedule, TIE, usd, type ScheduleFacts } from "./common";

/**
 * Schedule D: Supplemental Financial Statements.
 * Part VI (land, buildings, and equipment) is built from the ledger accounts mapped to
 * Part X line 10. Parts XI–XII reconcile audited financial statements to the return.
 */

export const PPE_CATEGORIES = [
  { key: "1a", label: "Land", pattern: /\bland\b/i },
  { key: "1b", label: "Buildings", pattern: /building/i },
  { key: "1c", label: "Leasehold improvements", pattern: /leasehold/i },
  { key: "1d", label: "Equipment", pattern: /equipment|furniture|computer|vehicle|machinery|fixture|software/i },
  { key: "1e", label: "Other", pattern: /.^/ },
] as const;

export const RECONCILING_ITEMS = [
  { value: "rev_2a", label: "Revenue in the audit, not on the return: net unrealized gains (losses) on investments (XI line 2a)" },
  { value: "rev_2b", label: "Revenue in the audit, not on the return: donated services and use of facilities (XI line 2b)" },
  { value: "rev_2c", label: "Revenue in the audit, not on the return: recoveries of prior-year grants (XI line 2c)" },
  { value: "rev_2d", label: "Revenue in the audit, not on the return: other (XI line 2d)" },
  { value: "rev_4a", label: "Revenue on the return, not in the audit: investment expenses netted in the audit (XI line 4a)" },
  { value: "rev_4b", label: "Revenue on the return, not in the audit: other (XI line 4b)" },
  { value: "exp_2a", label: "Expenses in the audit, not on the return: donated services and use of facilities (XII line 2a)" },
  { value: "exp_2b", label: "Expenses in the audit, not on the return: prior-year adjustments (XII line 2b)" },
  { value: "exp_2c", label: "Expenses in the audit, not on the return: other losses (XII line 2c)" },
  { value: "exp_2d", label: "Expenses in the audit, not on the return: other (XII line 2d)" },
  { value: "exp_4a", label: "Expenses on the return, not in the audit: investment expenses netted in the audit (XII line 4a)" },
  { value: "exp_4b", label: "Expenses on the return, not in the audit: other (XII line 4b)" },
] as const;

export interface ScheduleDIntake {
  auditedRevenue?: number;
  auditedExpenses?: number;
  reconcilingItems?: { item: (typeof RECONCILING_ITEMS)[number]["value"]; amount: number; description?: string }[];
}

export interface PpeRow {
  line: string;
  label: string;
  cost: Cents;
  depreciation: Cents;
  book: Cents;
}

interface Reconciliation {
  audited: Cents;
  line2: Record<string, Cents>;
  line2e: Cents;
  line3: Cents;
  line4: Record<string, Cents>;
  line4c: Cents;
  line5: Cents;
  /** Part I line 12 or 18 on the return. */
  returnTotal: Cents;
}

export interface ScheduleDOut {
  partVI?: { rows: PpeRow[]; total: Cents; partX: Cents; unassignedDepreciation: string[] };
  partXI?: Reconciliation;
  partXII?: Reconciliation;
}

function partVI(f: ScheduleFacts): NonNullable<ScheduleDOut["partVI"]> {
  const ids = new Set(f.ledger.mappings.filter((m) => m.line === "X.10").map((m) => m.accountId));
  const accounts = f.ledger.tb.accounts.filter((a) => ids.has(a.id));
  const rows = new Map<string, PpeRow>(PPE_CATEGORIES.map((c) => [c.key, { line: c.key, label: c.label, cost: 0, depreciation: 0, book: 0 }]));
  const categoryOf = (name: string) => PPE_CATEGORIES.find((c) => c.pattern.test(name))?.key;
  const depreciation = accounts.filter((a) => /accumulated|depreciation|amortization/i.test(a.name));
  for (const a of accounts) {
    if (depreciation.includes(a)) continue;
    rows.get(categoryOf(a.name) ?? "1e")!.cost += a.balance;
  }
  // Accumulated depreciation is a credit balance on an asset account (negative balance).
  const unassignedDepreciation: string[] = [];
  const depreciable = [...rows.values()].filter((r) => r.line !== "1a" && r.cost > 0);
  for (const a of depreciation) {
    const key = categoryOf(a.name.replace(/accumulated|depreciation|amortization/gi, ""));
    const target = key && key !== "1a" ? rows.get(key)! : depreciable.length === 1 ? depreciable[0]! : undefined;
    if (!target) {
      unassignedDepreciation.push(a.name);
      continue;
    }
    target.depreciation += -a.balance;
  }
  if (unassignedDepreciation.length) {
    const largest = depreciable.sort((x, y) => y.cost - x.cost)[0] ?? rows.get("1e")!;
    for (const a of depreciation.filter((d) => unassignedDepreciation.includes(d.name))) largest.depreciation += -a.balance;
  }
  const list = [...rows.values()].map((r) => ({ ...r, book: r.cost - r.depreciation }));
  return {
    rows: list,
    total: list.reduce((t, r) => t + r.book, 0),
    partX: amt(f, "X.10"),
    unassignedDepreciation,
  };
}

function reconcile(
  audited: Cents,
  items: NonNullable<ScheduleDIntake["reconcilingItems"]>,
  prefix: "rev" | "exp",
  returnTotal: Cents,
): Reconciliation {
  const pick = (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, items.filter((i) => i.item === `${prefix}_${k}`).reduce((t, i) => t + cents(i.amount), 0)]));
  const line2 = pick(["2a", "2b", "2c", "2d"]);
  const line4 = pick(["4a", "4b"]);
  const line2e = Object.values(line2).reduce((t, v) => t + v, 0);
  const line4c = Object.values(line4).reduce((t, v) => t + v, 0);
  const line3 = audited - line2e;
  return { audited, line2, line2e, line3, line4, line4c, line5: line3 + line4c, returnTotal };
}

export const scheduleD = defineSchedule<ScheduleDOut>({
  schedule: "D",
  title: "Supplemental Financial Statements",
  intake: [
    {
      title: "Schedule D: audited financial statements",
      help: "Complete only if this year's financial statements were audited. Enter the totals from the audited statement of activities and any differences from your books.",
      collapsible: true,
      fields: [
        { name: "auditedRevenue", type: "money", label: "Total revenue, gains, and other support per the audited financial statements ($)" },
        { name: "auditedExpenses", type: "money", label: "Total expenses and losses per the audited financial statements ($)" },
        {
          name: "reconcilingItems",
          type: "list",
          label: "Differences between the audit and the return",
          rows: 4,
          fields: [
            { name: "item", type: "select", label: "Type of difference", required: true, options: RECONCILING_ITEMS },
            { name: "amount", type: "money", label: "Amount ($)", required: true },
            { name: "description", type: "text", label: "Description" },
          ],
        },
      ],
    },
  ],

  build(f) {
    const out: ScheduleDOut = {};
    if (amt(f, "X.10") !== 0) out.partVI = partVI(f);
    if (f.intake.auditedFinancials) {
      const items = f.intake.reconcilingItems ?? [];
      const revenue = f.ledger.totals.grossRevenue - f.ledger.totals.nettedExpenses;
      out.partXI = reconcile(cents(f.intake.auditedRevenue), items, "rev", revenue);
      out.partXII = reconcile(cents(f.intake.auditedExpenses), items, "exp", f.totalExpenses);
    }
    return out;
  },

  rules: [
    {
      id: "d.ppe_ties",
      severity: "error",
      ref: "Schedule D, Part VI line 1e(d) vs Part X line 10c",
      description: "Book value of land, buildings, and equipment ties to the balance sheet",
      check: ({ out }) =>
        out.partVI && Math.abs(out.partVI.total - out.partVI.partX) > TIE
          ? `Schedule D Part VI book value ${usd(out.partVI.total)} does not equal Part X line 10c ${usd(out.partVI.partX)}`
          : undefined,
    },
    {
      id: "d.ppe_depreciation_assigned",
      severity: "warning",
      ref: "Schedule D, Part VI column (c)",
      description: "Accumulated depreciation is assigned to an asset category",
      check: ({ out }) =>
        out.partVI?.unassignedDepreciation.length
          ? `Assigned ${out.partVI.unassignedDepreciation.join(", ")} to the largest depreciable category; split it by category from the fixed asset schedule`
          : undefined,
    },
    {
      id: "d.audit_totals",
      severity: "error",
      ref: "Schedule D, Parts XI–XII line 1",
      description: "Audited totals are entered",
      check: ({ out, facts }) =>
        out.partXI && (facts.intake.auditedRevenue === undefined || facts.intake.auditedExpenses === undefined)
          ? "Enter total revenue and total expenses from the audited financial statements"
          : undefined,
    },
    {
      id: "d.reconciles",
      severity: "error",
      ref: "Schedule D, Parts XI–XII line 5",
      description: "Audited totals reconcile to Part I lines 12 and 18",
      check: ({ out, facts }) => {
        if (!out.partXI || facts.intake.auditedRevenue === undefined || facts.intake.auditedExpenses === undefined) return;
        const msgs: string[] = [];
        const r = out.partXI;
        const e = out.partXII!;
        if (Math.abs(r.line5 - r.returnTotal) > TIE)
          msgs.push(`Part XI line 5 is ${usd(r.line5)} but Part I line 12 is ${usd(r.returnTotal)}: ${usd(r.returnTotal - r.line5)} unexplained`);
        if (Math.abs(e.line5 - e.returnTotal) > TIE)
          msgs.push(`Part XII line 5 is ${usd(e.line5)} but Part I line 18 is ${usd(e.returnTotal)}: ${usd(e.returnTotal - e.line5)} unexplained`);
        return msgs;
      },
    },
    {
      id: "d.other_described",
      severity: "warning",
      ref: "Schedule D, Part XIII",
      description: "Other reconciling items are described",
      check: ({ facts }) =>
        (facts.intake.reconcilingItems ?? [])
          .filter((i) => /_(2d|4b)$/.test(i.item) && !i.description)
          .map((i) => `Describe the ${usd(cents(i.amount))} "other" reconciling item (reported in Part XIII)`),
    },
    {
      id: "d.fin48",
      severity: "info",
      ref: "Schedule D, Part X line 2",
      description: "Audited organizations report the uncertain tax positions footnote",
      check: ({ out }) =>
        out.partXI ? "If the audit includes a footnote on uncertain tax positions (ASC 740), quote it in Part X line 2" : undefined,
    },
  ],

  render(out) {
    const s: ReviewSection[] = [];
    if (out.partVI)
      s.push(
        table(
          "sched-d-6",
          "Schedule D Part VI: land, buildings, and equipment",
          [["line", "Line"], ["label", "Description"], ["cost", "(b) Cost or other basis", true], ["depreciation", "(c) Accumulated depreciation", true], ["book", "(d) Book value", true]],
          out.partVI.rows.filter((r) => r.cost || r.depreciation).map((r) => ({ line: r.line, label: r.label, cost: usd(r.cost), depreciation: usd(r.depreciation), book: usd(r.book) })),
          { footer: { line: "", label: "Total (must equal Part X line 10c)", cost: "", depreciation: "", book: usd(out.partVI.total) } },
        ),
      );
    for (const [id, title, r, labels] of [
      ["sched-d-11", "Schedule D Part XI: revenue per audit to the return", out.partXI, ["Total revenue per audited statements", "Total revenue (Part I line 12)"]],
      ["sched-d-12", "Schedule D Part XII: expenses per audit to the return", out.partXII, ["Total expenses per audited statements", "Total expenses (Part I line 18)"]],
    ] as const) {
      if (!r) continue;
      s.push(
        fields(id, title, [
          ["Line 1: " + labels[0], usd(r.audited)],
          ...Object.entries(r.line2).map(([k, v]) => [`Line ${k}`, usd(v)] as [string, string]),
          ["Line 2e: total", usd(r.line2e)],
          ["Line 3: line 1 minus line 2e", usd(r.line3)],
          ...Object.entries(r.line4).map(([k, v]) => [`Line ${k}`, usd(v)] as [string, string]),
          ["Line 4c: total", usd(r.line4c)],
          ["Line 5: total (line 3 plus line 4c)", usd(r.line5)],
          [labels[1], usd(r.returnTotal)],
        ]),
      );
    }
    return s;
  },
});
