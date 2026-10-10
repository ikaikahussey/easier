import { deadline, parseIsoDate } from "@/core/deadlines";
import { formatUsd, toDollars, type Cents } from "@/core/money";
import { defineProduct, quote, type QuoteLine, type EditableText, type ReviewSection, type RuleContext } from "@/core/product";
import { amountTable, fields, table } from "@/core/render";
import type { Rule } from "@/core/rules";
import { EZ_LABELS, isNettedLine, NONPROFIT_CATALOG } from "@/domains/nonprofit/lines";
import { lineAmount, lineRows, loadNonprofitLedger, TRIAL_BALANCE, type NonprofitLedger } from "@/domains/nonprofit/ledger";
import { nonprofitLedgerRules } from "@/domains/nonprofit/rules";
import { draftProgramDescriptions, draftScheduleO } from "./ai-tasks";
import { columnTotals, functionalExpenses, type FunctionalRow } from "./allocation";
import { selectFormType, type FormType } from "./form-type";
import { FORM_990_INTAKE, type Form990Intake } from "./intake";
import { requiredSchedules, type RequiredSchedule } from "./schedules";

export interface Form990Data {
  formType: FormType;
  formReason: string;
  usedAverage: boolean;
  taxYear: { begin: string; end: string };
  ledger: NonprofitLedger;
  grossReceipts: Cents;
  totalRevenue: Cents;
  totalExpenses: Cents;
  functional: FunctionalRow[];
  schedules: RequiredSchedule[];
  mission: string;
  programs: { name: string; description: string; expenses: Cents }[];
  scheduleO: { ref: string; text: string }[];
}

/** Placeholder list prices in cents; adjust after pilot pricing tests. */
export const PRICING = {
  "990-N": 99_00,
  "990-EZ": 750_00,
  "990": 1_950_00,
  /** Per schedule beyond A, B, and O. */
  extraSchedule: 150_00,
} as const;

const BUNDLED = new Set(["A", "B", "O"]);

type Ctx = RuleContext<Form990Intake, Form990Data>;

function taxYearFor(end: string) {
  const e = parseIsoDate(end);
  const begin = new Date(Date.UTC(e.getUTCFullYear() - 1, e.getUTCMonth(), e.getUTCDate() + 1));
  return { begin: begin.toISOString().slice(0, 10), end };
}

const pctOff = (a: Cents, b: Cents) => (b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b));

const rules: Rule<Ctx>[] = [
  ...nonprofitLedgerRules<Ctx>((c) => c.data.ledger),
  {
    id: "f990.private_foundation",
    severity: "error",
    description: "Private foundations file Form 990-PF, which this service does not prepare",
    check: ({ input }) => (input.intake.privateFoundation ? "Private foundations must file Form 990-PF" : undefined),
  },
  {
    id: "f990.program_shares",
    severity: "error",
    ref: "Part III, lines 4a–4c",
    description: "Program spending shares total 100%",
    check: ({ input, data }) => {
      if (data.formType === "990-N") return;
      const total = input.intake.programs.reduce((t, p) => t + p.share, 0);
      return Math.abs(total - 100) > 0.01 ? `Program shares total ${total}%, not 100%` : undefined;
    },
  },
  {
    id: "f990.cost_split",
    severity: "error",
    ref: "Part IX, columns (B)–(D)",
    description: "Shared cost allocation totals 100%",
    check: ({ input: { intake: i } }) => {
      const total = i.programPct + i.managementPct + i.fundraisingPct;
      return Math.abs(total - 100) > 0.01 ? `Shared cost allocation totals ${total}%, not 100%` : undefined;
    },
  },
  {
    id: "f990.columns_tie",
    severity: "error",
    ref: "Part IX, line 25",
    description: "Functional columns sum to each line total",
    check: ({ data }) =>
      data.functional
        .filter((r) => r.program + r.management + r.fundraising !== r.total)
        .map((r) => `${r.code} columns do not sum to ${formatUsd(r.total)}`),
  },
  {
    id: "f990.fundraising_zero",
    severity: "warning",
    ref: "Part IX, column (D)",
    description: "Organizations receiving contributions usually report some fundraising expense",
    check: ({ data }) => {
      const contributions = ["VIII.1a", "VIII.1d", "VIII.1e", "VIII.1f"].reduce((t, c) => t + lineAmount(data.ledger, c), 0);
      return data.formType === "990" && contributions > 0 && columnTotals(data.functional).fundraising === 0
        ? `Contributions of ${formatUsd(contributions)} with zero fundraising expense; watchdogs and the IRS flag this pattern`
        : undefined;
    },
  },
  {
    id: "f990.officers_listed",
    severity: "error",
    ref: "Part VII, Section A",
    description: "Compensated officers are listed with their compensation",
    check: ({ input, data }) =>
      lineAmount(data.ledger, "IX.5") > 0 && !input.intake.officers.some((o) => o.compensation > 0)
        ? `Officer compensation of ${formatUsd(lineAmount(data.ledger, "IX.5"))} is recorded but no listed officer is compensated`
        : undefined,
  },
  {
    id: "f990.officer_comp_ties",
    severity: "warning",
    ref: "Part VII vs Part IX, line 5",
    description: "Listed officer compensation agrees with the ledger",
    check: ({ input, data }) => {
      const listed = input.intake.officers.reduce((t, o) => t + Math.round(o.compensation * 100), 0);
      const booked = lineAmount(data.ledger, "IX.5");
      return listed > 0 && Math.abs(listed - booked) > 1_000_00
        ? `Part VII lists ${formatUsd(listed)} of officer compensation; ledger line 5 shows ${formatUsd(booked)}`
        : undefined;
    },
  },
  {
    id: "f990.board_independence",
    severity: "error",
    ref: "Part VI, lines 1a–1b",
    description: "Independent members cannot exceed voting members",
    check: ({ input: { intake: i } }) =>
      i.independentMembers > i.votingMembers
        ? `${i.independentMembers} independent members exceeds ${i.votingMembers} voting members`
        : undefined,
  },
  {
    id: "f990.prior_year_variance",
    severity: "warning",
    ref: "Part I, lines 12 and 18",
    description: "Large year-over-year changes are explained",
    check: ({ input, data }) => {
      const prior = input.prior[0];
      if (!prior) return;
      const out: string[] = [];
      for (const [label, cur, prev] of [
        ["Total revenue", data.totalRevenue, prior.totalRevenue],
        ["Total expenses", data.totalExpenses, prior.totalExpenses],
        ["Total assets", data.ledger.totals.assets, prior.totalAssets],
      ] as const) {
        if (prev === undefined) continue;
        if (pctOff(cur, prev) > 0.25 && Math.abs(cur - prev) > 10_000_00)
          out.push(`${label} changed from ${formatUsd(prev)} (${prior.year}) to ${formatUsd(cur)}; confirm and document the reason`);
      }
      return out;
    },
  },
  {
    id: "f990.normally_test",
    severity: "info",
    ref: "Form 990-N eligibility",
    description: "990-N eligibility uses a three-year average",
    check: ({ data }) =>
      data.formType === "990-N" && !data.usedAverage
        ? "990-N selected on fewer than three years of receipts; confirm prior-year receipts"
        : undefined,
  },
  {
    id: "f990.event_split",
    severity: "info",
    ref: "Part VIII, lines 1c and 8a",
    description: "Event receipts are split between contributions and gross income",
    check: ({ data }) =>
      lineAmount(data.ledger, "VIII.8a") > 0
        ? "Split event receipts: the amount above the fair value of benefits to attendees is a contribution (line 1c)"
        : undefined,
  },
  {
    id: "f990.public_policy_answers",
    severity: "info",
    ref: "Part VI, lines 12a, 13, 14",
    description: "Governance answers are public",
    check: ({ input: { intake: i } }) => {
      const missing = [
        !i.conflictPolicy && "conflict-of-interest",
        !i.whistleblowerPolicy && "whistleblower",
        !i.documentRetentionPolicy && "document retention",
      ].filter(Boolean);
      return missing.length
        ? `The return will publicly report no ${missing.join(", ")} policy; offer the client policy templates before filing`
        : undefined;
    },
  },
];

function render(d: Form990Data, input: { intake: Form990Intake }): ReviewSection[] {
  const i = input.intake;
  const summary = fields("summary", "Summary", [
    ["Form", d.formType],
    ["Why this form", d.formReason],
    ["Tax year", `${d.taxYear.begin} to ${d.taxYear.end}`],
    ["Gross receipts", formatUsd(d.grossReceipts)],
    ["Total revenue", formatUsd(d.totalRevenue), "Part I, line 12"],
    ["Total expenses", formatUsd(d.totalExpenses), "Part I, line 18"],
    ["Revenue less expenses", formatUsd(d.totalRevenue - d.totalExpenses), "Part I, line 19"],
    ["Total assets (end of year)", formatUsd(d.ledger.totals.assets), "Part I, line 20"],
    ["Total liabilities (end of year)", formatUsd(d.ledger.totals.liabilities), "Part I, line 21"],
    ["Net assets (end of year)", formatUsd(d.ledger.totals.endingNetAssets), "Part I, line 22"],
  ]);
  if (d.formType === "990-N") return [summary];

  const schedules = table(
    "schedules",
    "Required schedules",
    [["schedule", "Schedule"], ["title", "Title"], ["ref", "Trigger"], ["reason", "Reason"]],
    d.schedules.map((s) => ({ ...s })),
  );
  const programs = table(
    "programs",
    "Program service accomplishments (Part III)",
    [["name", "Program"], ["description", "Description"], ["expenses", "Expenses", true]],
    d.programs.map((p) => ({ name: p.name, description: p.description, expenses: formatUsd(p.expenses) })),
    { note: `Mission: ${d.mission}` },
  );
  const officers = table(
    "officers",
    "Officers, directors, and key employees (Part VII)",
    [["name", "Name"], ["title", "Title"], ["hours", "Hours/week", true], ["compensation", "Compensation", true]],
    i.officers.map((o) => ({ ...o, compensation: formatUsd(Math.round(o.compensation * 100)) })),
  );
  const governance = fields("governance", "Governance (Part VI)", [
    ["Voting members", i.votingMembers, "line 1a"],
    ["Independent voting members", i.independentMembers, "line 1b"],
    ["Family or business relationships", i.familyRelationships, "line 2"],
    ["Minutes kept", i.minutesKept, "line 8a"],
    ["Conflict-of-interest policy", i.conflictPolicy, "line 12a"],
    ["Whistleblower policy", i.whistleblowerPolicy, "line 13"],
    ["Document retention policy", i.documentRetentionPolicy, "line 14"],
    ["Independent compensation review", i.compensationProcess, "line 15a"],
  ]);
  const scheduleO = table(
    "schedule-o",
    "Schedule O narratives",
    [["ref", "Reference"], ["text", "Text"]],
    d.scheduleO.map((e) => ({ ...e })),
  );

  if (d.formType === "990-EZ") {
    const ez = new Map<string, Cents>();
    for (const l of NONPROFIT_CATALOG.lines) {
      const v = lineAmount(d.ledger, l.code);
      if (v) ez.set(l.ez, (ez.get(l.ez) ?? 0) + v);
    }
    const rows = [...ez.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
      .map(([code, amount]) => ({ code, label: EZ_LABELS[code] ?? code, amount }));
    return [
      summary,
      schedules,
      programs,
      officers,
      governance,
      amountTable("ez", "Form 990-EZ Parts I–II", rows, "", "Balance sheet lines are end-of-year amounts."),
    ];
  }

  const t = columnTotals(d.functional);
  const revenueRows = [
    ...lineRows(d.ledger, "revenue"),
    ...lineRows(d.ledger, "expense", isNettedLine).map(
      (r) => ({ ...r, label: `Less: ${r.label}`, amount: -r.amount }),
    ),
  ];
  return [
    summary,
    schedules,
    programs,
    officers,
    governance,
    amountTable("part-viii", "Statement of Revenue (Part VIII)", revenueRows, "Total revenue (line 12)"),
    table(
      "part-ix",
      "Statement of Functional Expenses (Part IX)",
      [["code", "Line"], ["label", "Description"], ["total", "(A) Total", true], ["program", "(B) Program", true],
        ["management", "(C) Management", true], ["fundraising", "(D) Fundraising", true]],
      d.functional.map((r) => ({
        code: r.code,
        label: r.label,
        total: formatUsd(r.total),
        program: formatUsd(r.program),
        management: formatUsd(r.management),
        fundraising: formatUsd(r.fundraising),
      })),
      {
        footer: {
          code: "25",
          label: "Total functional expenses",
          total: formatUsd(t.total),
          program: formatUsd(t.program),
          management: formatUsd(t.management),
          fundraising: formatUsd(t.fundraising),
        },
      },
    ),
    amountTable("part-x-assets", "Balance Sheet — Assets (Part X)", lineRows(d.ledger, "asset"), "Total assets (line 16)"),
    amountTable(
      "part-x-liabilities",
      "Balance Sheet — Liabilities (Part X)",
      lineRows(d.ledger, "liability"),
      "Total liabilities (line 26)",
    ),
    fields("part-x-net-assets", "Balance Sheet — Net Assets (Part X)", [
      ["Beginning net assets (per ledger)", formatUsd(d.ledger.totals.beginningNetAssets)],
      ["Revenue less expenses", formatUsd(d.totalRevenue - d.totalExpenses)],
      ["Total net assets (line 32)", formatUsd(d.ledger.totals.endingNetAssets)],
    ]),
    scheduleO,
  ];
}

export const form990 = defineProduct<Form990Intake, Form990Data>({
  slug: "form-990",
  line: "Plainfirm Tax",
  name: "Form 990 preparation",
  tagline: "Your annual nonprofit return, prepared from your books and signed by an enrolled agent or CPA.",
  status: "live",
  reviewerCredentials: ["EA", "CPA"],
  period: { name: "period", type: "date", label: "Fiscal year end date", required: true },
  intake: FORM_990_INTAKE,
  documents: [TRIAL_BALANCE],
  deadline: (period) => deadline(period, { months: 5, day: 15, extensionMonths: 6 }),

  quote: (_intake, data) => {
    if (!data) return quote("Estimate", [{ label: "Form 990 (estimate until books are uploaded)", cents: PRICING["990"] }]);
    const lines: QuoteLine[] = [{ label: `Form ${data.formType}`, cents: PRICING[data.formType] }];
    const extras = data.schedules.filter((s) => !BUNDLED.has(s.schedule));
    if (data.formType !== "990-N" && extras.length)
      lines.push({
        label: `Additional schedules (${extras.map((s) => s.schedule).join(", ")})`,
        cents: extras.length * PRICING.extraSchedule,
      });
    return quote(`Form ${data.formType}`, lines);
  },

  async build(input, ai) {
    const { ledger, editable } = await loadNonprofitLedger(input, ai);
    const i = input.intake;
    const t = ledger.totals;
    const grossReceipts = NONPROFIT_CATALOG.lines
      .filter((l) => l.type === "revenue")
      .reduce((s, l) => s + Math.max(0, lineAmount(ledger, l.code)), 0);
    const prior = input.prior.map((p) => p.totalRevenue).filter((v): v is Cents => v !== undefined);
    const form = selectFormType(grossReceipts, t.assets, prior);

    const functional = functionalExpenses(ledger, {
      program: i.programPct,
      management: i.managementPct,
      fundraising: i.fundraisingPct,
    });
    const programTotal = columnTotals(functional).program;
    const text = input.overrides.text;

    const aiPrograms = await ai.run(draftProgramDescriptions, {
      mission: i.mission,
      programs: i.programs.map((p) => ({ ...p, expenses: toDollars(Math.round((programTotal * p.share) / 100)) })),
    });
    const programs = i.programs.map((p, idx) => ({
      name: p.name,
      description: text[`program.${idx}`] ?? aiPrograms.programs[idx]?.description ?? p.description,
      expenses: Math.round((programTotal * p.share) / 100),
    }));

    const aiO = await ai.run(draftScheduleO, {
      formReviewProcess: i.formReviewProcess,
      conflictPolicy: i.conflictPolicy,
      conflictMonitoring: i.conflictMonitoring,
      documentsAvailability: i.documentsAvailability,
      website: input.org.website,
    });
    const scheduleO = aiO.entries.map((e) => ({ ref: e.ref, text: text[`scheduleO.${e.ref}`] ?? e.text }));
    const mission = text.mission ?? i.mission;

    const source = (key: string, taskId?: string): EditableText["source"] => {
      if (key in text) return "override";
      if (!taskId) return "intake";
      return ai.runs.find((r) => r.task === taskId)?.model === "fallback" ? "fallback" : "ai";
    };

    const data: Form990Data = {
      formType: form.formType,
      formReason: form.reason,
      usedAverage: form.usedAverage,
      taxYear: taxYearFor(input.period),
      ledger,
      grossReceipts,
      totalRevenue: t.grossRevenue - t.nettedExpenses,
      totalExpenses: t.functionalExpenses,
      functional,
      schedules: requiredSchedules(form.formType, { intake: i, ledger }),
      mission,
      programs,
      scheduleO,
    };

    return {
      data,
      editable: {
        ...editable,
        text: [
          { key: "mission", label: "Mission (Part I line 1, Part III line 1)", value: mission, source: source("mission") },
          ...programs.map((p, idx) => ({
            key: `program.${idx}`,
            label: `Part III — ${p.name}`,
            value: p.description,
            source: source(`program.${idx}`, draftProgramDescriptions.id),
          })),
          ...scheduleO.map((e) => ({
            key: `scheduleO.${e.ref}`,
            label: `Schedule O — ${e.ref}`,
            value: e.text,
            source: source(`scheduleO.${e.ref}`, draftScheduleO.id),
          })),
        ],
      },
    };
  },
  rules,
  render,
});
