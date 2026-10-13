import { describe, expect, it } from "vitest";
import { buildDraft } from "@/core/draft";
import { allFields } from "@/core/fields";
import { formSchema } from "@/core/fields";
import type { Llm } from "@/core/ai/llm";
import { PRODUCTS } from "@/products";
import { form990, PRICING, type Form990Data } from "@/products/form-990";
import { selectFormType } from "@/products/form-990/form-type";
import { books } from "@/products/books";
import { columnTotals } from "@/products/form-990/allocation";
import { input990, intake990 } from "./fixtures";

const ids = (findings: { ruleId: string }[]) => findings.map((f) => f.ruleId);

describe("product registry", () => {
  it("has unique slugs and unique rule ids per product", () => {
    expect(new Set(PRODUCTS.map((p) => p.slug)).size).toBe(PRODUCTS.length);
    for (const p of PRODUCTS) {
      const ruleIds = p.rules.map((r) => r.id);
      expect(new Set(ruleIds).size, p.slug).toBe(ruleIds.length);
      const names = allFields(p.intake).map((f) => f.name);
      expect(new Set(names).size, p.slug).toBe(names.length);
    }
  });
  it("validates the sample intake against the declared form", () => {
    expect(formSchema(form990.intake).safeParse(intake990).success).toBe(true);
  });
});

describe("form type selection", () => {
  it("applies IRS thresholds", () => {
    expect(selectFormType(40_000_00, 0).formType).toBe("990-N");
    expect(selectFormType(60_000_00, 0, [40_000_00, 40_000_00])).toMatchObject({ formType: "990-N", usedAverage: true });
    expect(selectFormType(199_999_00, 499_999_00).formType).toBe("990-EZ");
    expect(selectFormType(150_000_00, 500_000_00).formType).toBe("990");
    expect(selectFormType(200_000_00, 0).formType).toBe("990");
  });
});

describe("Form 990 draft (full return)", async () => {
  const draft = await buildDraft(form990, input990());
  const d = draft.data as Form990Data;

  it("selects Form 990 and computes Part I totals", () => {
    expect(d.formType).toBe("990");
    expect(d.grossReceipts).toBe(496_500_00);
    expect(d.totalRevenue).toBe(487_500_00); // net of $9,000 gala expenses
    expect(d.totalExpenses).toBe(471_700_00);
    expect(d.ledger.totals.assets).toBe(266_000_00);
    expect(d.ledger.totals.endingNetAssets).toBe(241_500_00);
    expect(d.taxYear).toEqual({ begin: "2025-01-01", end: "2025-12-31" });
  });

  it("classifies by keyword and isolates the unknown account", () => {
    const by = Object.fromEntries(d.ledger.mappings.map((m) => [m.accountId, m.line]));
    expect(by).toMatchObject({
      "4200": "VIII.1e",
      "4400": "VIII.8a",
      "5000": "IX.5",
      "5110": "IX.9",
      "6400": "IX.23",
      "6600": "VIII.8b",
      "6700": "IX.2",
      "1510": "X.10",
      "3100": "X.28",
      "6800": "IX.24",
    });
    expect(d.ledger.mappings.find((m) => m.accountId === "6900")!.source).toBe("fallback");
  });

  it("allocates functional expenses and ties columns", () => {
    const t = columnTotals(d.functional);
    expect(t.program + t.management + t.fundraising).toBe(t.total);
    const accounting = d.functional.find((r) => r.code === "IX.11c")!;
    expect(accounting.management).toBe(accounting.total);
    const scholarships = d.functional.find((r) => r.code === "IX.2")!;
    expect(scholarships.program).toBe(scholarships.total);
  });

  it("derives schedules from Part IV triggers", () => {
    expect(d.schedules.map((s) => s.schedule)).toEqual(["A", "B", "D", "G", "I", "O"]);
  });

  it("blocks approval on the unclassified account and surfaces review notes", () => {
    const f = ids(draft.findings);
    expect(f).toContain("ledger.unclassified");
    expect(f).toContain("f990.event_split");
    expect(f).toContain("f990.public_policy_answers");
    expect(f).not.toContain("ledger.balanced");
    expect(f).not.toContain("nonprofit.balance_sheet_ties");
    expect(draft.findings[0]!.severity).toBe("error");
  });

  it("prices by form type plus schedules outside the bundle", () => {
    expect(form990.quote(intake990, d).total).toBe(PRICING["990"] + 3 * PRICING.extraSchedule);
    expect(form990.quote(intake990).tier).toBe("Estimate");
  });

  it("estimates human hours from the work in the draft", async () => {
    const { priceEngagement } = await import("@/core/product");
    const { pledgeFor } = await import("@/core/pledge");
    const tasks = form990.labor(intake990, d);
    expect(tasks.find((t) => t.label.startsWith("Classify"))!.hours).toBeCloseTo(d.ledger.tb.accounts.length * 0.05, 5);
    expect(tasks.some((t) => t.label.startsWith("Prepare Schedules A, B, D, G, I"))).toBe(true);
    const q = priceEngagement(form990, intake990, d);
    expect(q.pledge).toEqual(pledgeFor(tasks));
    expect(q.pledge!.contribution).toBe(Math.round(Math.round(q.pledge!.hours * 23_08) * 0.124));
    expect(q.total).toBe(PRICING["990"] + 3 * PRICING.extraSchedule);
  });

  it("estimates 990-N labor as a single short task", async () => {
    const { form990Labor, TYPICAL_990 } = await import("@/products/form-990");
    expect(form990Labor({ ...TYPICAL_990, formType: "990-N" })).toEqual([
      { label: "Confirm 990-N eligibility and file the e-Postcard", hours: 0.75 },
    ]);
    expect(form990Labor({ ...TYPICAL_990, formType: "990-EZ" }).some((t) => t.label.startsWith("Allocate"))).toBe(false);
  });

  it("renders full-return worksheet sections", () => {
    expect(draft.sections.map((s) => s.id)).toEqual([
      "summary", "schedules", "programs", "officers", "governance", "part-viii", "part-ix",
      "part-x-assets", "part-x-liabilities", "part-x-net-assets",
      "sched-a-1", "sched-a-2a", "sched-a-2b", "sched-a-2c", "sched-a-2-excess",
      "sched-b-rule", "sched-b-1",
      "sched-d-6",
      "sched-g-2",
      "sched-i-1", "sched-i-3",
      "schedule-o",
    ]);
  });

  it("uses deterministic fallbacks without an API key", () => {
    expect(draft.ai.every((r) => r.model === "fallback")).toBe(true);
    expect(d.programs[0]!.description).toBe("Daily tutoring for grades 3–8. Served 220 students.");
    expect(d.programs[0]!.expenses + d.programs[1]!.expenses).toBe(columnTotals(d.functional).program);
  });

  it("reviewer overrides clear the blocking finding and replace text", async () => {
    const again = await buildDraft(
      form990,
      input990("tb-990.csv", {
        overrides: { mappings: { "6900": "IX.13" }, text: { "program.0": "Edited." } },
      }),
      { priorAi: draft.ai },
    );
    const a = again.data as Form990Data;
    expect(ids(again.findings)).not.toContain("ledger.unclassified");
    expect(again.findings.filter((x) => x.severity === "error")).toEqual([]);
    expect(a.programs[0]!.description).toBe("Edited.");
    expect(again.editable.text!.find((t) => t.key === "program.0")!.source).toBe("override");
  });

  it("flags prior-year variance", async () => {
    const v = await buildDraft(form990, input990("tb-990.csv", { prior: [{ year: 2024, totalRevenue: 200_000_00 }] }));
    expect(ids(v.findings)).toContain("f990.prior_year_variance");
  });

  it("validates intake-derived rules", async () => {
    const bad = await buildDraft(
      form990,
      input990("tb-990.csv", {
        intake: { ...intake990, programPct: 50, independentMembers: 12, officers: [{ name: "A", title: "Chair", hours: 1, compensation: 0 }] },
      }),
    );
    expect(ids(bad.findings)).toEqual(expect.arrayContaining(["f990.cost_split", "f990.board_independence", "f990.officers_listed"]));
  });
});

describe("Form 990 draft (EZ)", async () => {
  const draft = await buildDraft(form990, input990("tb-ez.csv"));
  const d = draft.data as Form990Data;
  it("selects 990-EZ and renders the EZ summary", () => {
    expect(d.formType).toBe("990-EZ");
    expect(d.totalRevenue).toBe(120_000_00);
    expect(draft.sections.map((s) => s.id)).toContain("ez");
    expect(draft.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(d.schedules.map((s) => s.schedule)).toEqual(["A", "B"]);
  });
});

describe("AI path", () => {
  it("accepts valid AI classifications and labels them for review", async () => {
    const llm: Llm = {
      model: "test-model",
      async generate<T>(req: { prompt: string }) {
        if (req.prompt.includes("Accounts to classify"))
          return { mappings: [{ accountId: "6900", line: "IX.13", confidence: 0.7, reason: "Supplies" }] } as T;
        if (req.prompt.includes("Board review"))
          return { entries: [{ ref: "Part VI, line 11b", text: "AI text" }] } as T;
        return { programs: [{ name: "x", description: "AI program" }, { name: "y", description: "AI two" }] } as T;
      },
    };
    const draft = await buildDraft(form990, input990(), { llm });
    const d = draft.data as Form990Data;
    expect(d.ledger.mappings.find((m) => m.accountId === "6900")).toMatchObject({ line: "IX.13", source: "ai" });
    expect(ids(draft.findings)).toContain("ledger.ai_classified");
    expect(ids(draft.findings)).not.toContain("ledger.unclassified");
    expect(d.programs[0]!.description).toBe("AI program");
    expect(draft.editable.text!.find((t) => t.key === "program.0")!.source).toBe("ai");
  });
});

describe("Books (Augmented Accountants module)", () => {
  it("reuses the nonprofit ledger and rules", async () => {
    const base = input990("tb-ez.csv");
    const draft = await buildDraft(books, { ...base, period: "2026-09-30", intake: { basis: "accrual" } });
    expect(draft.sections[0]!.id).toBe("summary");
    expect(ids(draft.findings)).not.toContain("ledger.balanced");
    expect(books.deadline!("2026-09-30").original).toBe("2026-10-15");
  });
});
