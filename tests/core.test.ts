import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allocate, formatUsd, parseAmount } from "@/core/money";
import { parseCsv } from "@/core/ledger/csv";
import { parseTrialBalance } from "@/core/ledger/trial-balance";
import { classifyAccounts } from "@/core/ledger/catalog";
import { deadline, legalHolidays } from "@/core/deadlines";
import { formDataToObject, objectToFormValues, parseForm, type FormSpec } from "@/core/fields";
import { availableActions, nextStatus, WorkflowError } from "@/core/workflow";
import { elapsedSeconds, formatDuration, MAX_TIMER_SECONDS } from "@/core/review-time";
import { flatten, toCsv } from "@/core/flatten";
import { consentHash, renderConsent } from "@/core/consents";
import { runRules, adaptRules } from "@/core/rules";
import { AiRunner, type AiTask, type Llm } from "@/core/ai/llm";
import { NONPROFIT_CATALOG } from "@/domains/nonprofit/lines";

describe("money", () => {
  it("parses accounting formats", () => {
    expect(parseAmount("$1,234.56")).toBe(123456);
    expect(parseAmount("(1,000)")).toBe(-100000);
    expect(parseAmount("-12.5")).toBe(-1250);
    expect(parseAmount("")).toBe(0);
    expect(() => parseAmount("abc")).toThrow();
  });
  it("allocates without losing cents", () => {
    const a = allocate(10001, { p: 1, m: 1, f: 1 });
    expect(a.p + a.m + a.f).toBe(10001);
    const b = allocate(-999, { p: 0.7, m: 0.2, f: 0.1 });
    expect(b.p + b.m + b.f).toBe(-999);
  });
  it("formats whole dollars", () => expect(formatUsd(123456)).toBe("$1,235"));
});

describe("csv + trial balance", () => {
  it("handles quotes, embedded commas, CRLF", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
  it("reads debit/credit exports and skips totals", () => {
    const tb = parseTrialBalance("Account Number,Account Name,Type,Debit,Credit\n1000,Checking,Bank,100,\n4000,Donations,Income,,100\n,Total,,100,100\n");
    expect(tb.accounts).toHaveLength(2);
    expect(tb.accounts[1]).toMatchObject({ type: "revenue", balance: 10000 });
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
  it("reads signed balances and infers type from numbers embedded in names", () => {
    const tb = parseTrialBalance("Account,Balance\n1000 Checking,50\n2000 Card,-20\n3000 Net Assets,-30\n");
    expect(tb.accounts.map((a) => [a.number, a.type, a.balance])).toEqual([
      ["1000", "asset", 5000],
      ["2000", "liability", 2000],
      ["3000", "equity", 3000],
    ]);
  });
  it("classifies equity types before asset keywords", () => {
    const tb = parseTrialBalance("Name,Type,Balance\nRestricted funds,Net Assets,-5\nCash,Bank,5\n");
    expect(tb.accounts[0]!.type).toBe("equity");
  });
  it("rejects files without required columns", () => {
    expect(() => parseTrialBalance("Foo,Bar\n1,2\n")).toThrow(/account name/);
  });
});

describe("classification pipeline", () => {
  const tb = parseTrialBalance(
    "Name,Type,Debit,Credit\nOffice Supplies,Expense,10,\nWidget Thing,Expense,5,\nNet Assets Without Donor Restrictions,Equity,,15\n",
  );
  it("uses overrides, then keywords, then AI, then fallback", async () => {
    const m = await classifyAccounts(tb.accounts, NONPROFIT_CATALOG, {
      overrides: { "office-supplies": "IX.14" },
      ai: async (accts) => accts.map((a) => ({ accountId: a.id, line: "VIII.2", confidence: 0.8 })), // wrong type: ignored
    });
    expect(m.map((x) => [x.line, x.source])).toEqual([
      ["IX.14", "override"],
      ["IX.24", "fallback"],
      ["X.27", "keyword"],
    ]);
  });
  it("ignores overrides that do not fit the account type", async () => {
    const m = await classifyAccounts(tb.accounts, NONPROFIT_CATALOG, { overrides: { "office-supplies": "X.1" } });
    expect(m[0]).toMatchObject({ line: "IX.13", source: "keyword" });
  });
});

describe("deadlines", () => {
  it("rolls weekend due dates forward", () => {
    // Calendar 2025 year: May 15, 2026 is a Friday; extension Nov 15, 2026 is a Sunday.
    expect(deadline("2025-12-31", { months: 5, day: 15, extensionMonths: 6 })).toEqual({
      original: "2026-05-15",
      extended: "2026-11-16",
    });
  });
  it("handles fiscal years ending mid-year", () => {
    expect(deadline("2026-06-30", { months: 5, day: 15 }).original).toBe("2026-11-16");
  });
  it("knows observed holidays", () => {
    const h = legalHolidays(2026);
    expect(h.has("2026-07-03")).toBe(true); // July 4 falls on Saturday
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving
  });
});

describe("declarative fields", () => {
  const form: FormSpec = [
    {
      title: "T",
      fields: [
        { name: "name", type: "text", label: "Name", required: true },
        { name: "ok", type: "yesno", label: "OK?", required: true },
        { name: "agree", type: "checkbox", label: "Agree" },
        { name: "rows", type: "list", label: "Rows", rows: 3, required: true, fields: [
          { name: "x", type: "text", label: "X", required: true },
          { name: "n", type: "money", label: "N", required: true },
        ] },
      ],
    },
  ];
  it("parses nested form data and drops blank rows", () => {
    const fd = new FormData();
    fd.set("name", " Ann ");
    fd.set("ok", "no");
    fd.set("rows.0.x", "a");
    fd.set("rows.0.n", "12.5");
    const r = parseForm<{ name: string; ok: boolean; agree: boolean; rows: { x: string; n: number }[] }>(fd, form);
    expect(r).toEqual({ ok: true, data: { name: "Ann", ok: false, agree: false, rows: [{ x: "a", n: 12.5 }] } });
  });
  it("reports readable errors", () => {
    const fd = new FormData();
    fd.set("rows.1.x", "b");
    const r = parseForm(fd, form);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("Name"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("Rows › row 1 › N"))).toBe(true);
    }
  });
  it("round-trips saved answers back into form values", () => {
    const saved = { name: "Ann", ok: false, agree: true, rows: [{ x: "a", n: 12.5 }, { x: "b", n: 3 }] };
    const values = objectToFormValues(form[0]!.fields, saved);
    expect(values).toEqual({ name: "Ann", ok: "no", agree: "on", "rows.0.x": "a", "rows.0.n": "12.5", "rows.1.x": "b", "rows.1.n": "3" });
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    expect(parseForm(fd, form)).toEqual({ ok: true, data: saved });
  });

  it("maps list fields to row-indexed names", () => {
    const fd = new FormData();
    fd.set("rows.2.x", "z");
    expect((formDataToObject(fd, form[0]!.fields).rows as { x?: string }[])[2]!.x).toBe("z");
  });
});

describe("workflow", () => {
  it("enforces roles, notes, and blocking findings", () => {
    expect(nextStatus("awaiting_documents", "submit", { role: "client", errorCount: 0 })).toBe("in_review");
    expect(() => nextStatus("in_review", "approve", { role: "client", errorCount: 0 })).toThrow(WorkflowError);
    expect(() => nextStatus("in_review", "approve", { role: "reviewer", errorCount: 2 })).toThrow(/blocking/);
    expect(() => nextStatus("in_review", "request_changes", { role: "reviewer", errorCount: 0 })).toThrow(/note/);
    expect(nextStatus("in_review", "approve", { role: "reviewer", errorCount: 0 })).toBe("approved");
    expect(availableActions("approved", "reviewer").sort()).toEqual(["deliver", "reopen"]);
  });

  it("adds e-filing states only for products filed with the IRS", () => {
    expect(availableActions("delivered", "reviewer")).toEqual([]);
    expect(availableActions("delivered", "reviewer", { filing: true })).toEqual(["record_filing"]);
    expect(availableActions("filed", "admin", { filing: true }).sort()).toEqual(["record_acceptance", "record_rejection"]);
    expect(availableActions("rejected", "reviewer", { filing: true }).sort()).toEqual(["record_filing", "reopen"]);
    expect(availableActions("accepted", "admin", { filing: true })).toEqual([]);
    expect(() => nextStatus("delivered", "record_filing", { role: "reviewer", errorCount: 0 })).toThrow(/not filed/);
    expect(() => nextStatus("filed", "record_rejection", { role: "reviewer", errorCount: 0, filing: true })).toThrow(/note/);
    expect(nextStatus("filed", "record_acceptance", { role: "reviewer", errorCount: 0, filing: true })).toBe("accepted");
  });
});

describe("review time", () => {
  it("caps a forgotten timer and formats durations", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    expect(elapsedSeconds(start, new Date("2026-10-01T01:30:00Z"))).toBe(5400);
    expect(elapsedSeconds(start, new Date("2026-10-02T00:00:00Z"))).toBe(MAX_TIMER_SECONDS);
    expect(elapsedSeconds(start, new Date("2026-09-30T00:00:00Z"))).toBe(0);
    expect(formatDuration(0)).toBe("0 m");
    expect(formatDuration(42 * 60)).toBe("42 m");
    expect(formatDuration(3900)).toBe("1 h 05 m");
  });
});

describe("keying sheet", () => {
  it("flattens nested export data into field/value rows", () => {
    const rows = flatten({ form: "990", partI: { "12_totalRevenue": { currentYear: 487500, priorYear: undefined } }, partIV: [true, false], x: null, y: "" });
    expect(rows).toEqual([
      ["form", "990"],
      ["partI.12_totalRevenue.currentYear", "487500"],
      ["partIV.1", "Yes"],
      ["partIV.2", "No"],
    ]);
  });

  it("quotes commas, quotes, and anything a spreadsheet would run as a formula", () => {
    expect(toCsv([["a", 'Kōkua "Learning", Inc.'], ["b", "=HYPERLINK(1)"], ["c", "-5"]])).toBe(
      'field,value\r\na,"Kōkua ""Learning"", Inc."\r\nb,"=HYPERLINK(1)"\r\nc,"-5"\r\n',
    );
  });
});

describe("consents", () => {
  it("hashes the exact text shown, so a wording change invalidates prior acceptance", () => {
    const c = { orgName: "Org A", productName: "Form 990 preparation", period: "2025-12-31", preparer: "Jane Doe, EA", filed: true };
    expect(consentHash("irc_7216", c)).toBe(consentHash("irc_7216", { ...c }));
    expect(consentHash("irc_7216", c)).not.toBe(consentHash("irc_7216", { ...c, preparer: "John Roe, CPA" }));
    expect(consentHash("engagement_letter", c)).not.toBe(consentHash("engagement_letter", { ...c, filed: false }));
    const text = renderConsent("irc_7216", c).join(" ");
    for (const required of ["Org A", "Jane Doe, EA", "Anthropic", "TIGTA", "one year"]) expect(text).toContain(required);
  });
});

describe("rules", () => {
  it("sorts by severity, converts crashes into findings, and adapts contexts", () => {
    const rules = adaptRules(
      [
        { id: "a", severity: "info" as const, description: "", check: () => "i" },
        { id: "b", severity: "error" as const, description: "", check: (n: number) => (n > 1 ? ["x", { message: "y", subject: "s" }] : undefined) },
        { id: "c", severity: "warning" as const, description: "", check: () => { throw new Error("boom"); } },
      ],
      (ctx: { n: number }) => ctx.n,
    );
    const f = runRules(rules, { n: 2 });
    expect(f.map((x) => x.ruleId)).toEqual(["b", "b", "c", "a"]);
    expect(f[1]!.subject).toBe("s");
    expect(f[2]!.message).toMatch(/boom/);
  });
});

describe("AiRunner", () => {
  const task: AiTask<{ q: string }, { a: string }> = {
    id: "t",
    version: 1,
    system: "s",
    prompt: ({ q }) => q,
    schema: z.object({ a: z.string() }),
    fallback: ({ q }) => ({ a: `fallback:${q}` }),
  };
  const counting = (): Llm & { calls: number } => ({
    model: "m",
    calls: 0,
    async generate<T>() {
      this.calls++;
      return { a: "model" } as T;
    },
  });

  it("uses the fallback without a model", async () => {
    const r = new AiRunner(undefined);
    expect(await r.run(task, { q: "x" })).toEqual({ a: "fallback:x" });
    expect(r.runs[0]!.model).toBe("fallback");
  });
  it("reuses prior outputs for identical inputs and re-runs on change", async () => {
    const llm = counting();
    const first = new AiRunner(llm);
    await first.run(task, { q: "x" });
    const second = new AiRunner(llm, first.runs);
    expect(await second.run(task, { q: "x" })).toEqual({ a: "model" });
    expect(llm.calls).toBe(1);
    await second.run(task, { q: "y" });
    expect(llm.calls).toBe(2);
  });
  it("falls back and records the error when the model fails", async () => {
    const r = new AiRunner({ model: "m", generate: async () => { throw new Error("down"); } });
    expect(await r.run(task, { q: "z" })).toEqual({ a: "fallback:z" });
    expect(r.runs[0]!.error).toBe("down");
  });
});

describe("Labor Pledge", async () => {
  const { pledgeFor, laborTask, LABOR_PLEDGE } = await import("@/core/pledge");
  it("is human hours × living wage × the OASDI rate", () => {
    expect(LABOR_PLEDGE.rate).toBe(0.124);
    expect(LABOR_PLEDGE.hourlyWage).toBe(23_08);
    const p = pledgeFor([laborTask("setup", 1), laborTask("accounts", 0, 0.05, 60)]);
    expect(p.hours).toBe(4);
    expect(p.laborValue).toBe(92_32); // 4 h × $23.08
    expect(p.contribution).toBe(11_45); // $92.32 × 12.4% = $11.447
  });
  it("drops zero-hour tasks and accepts another wage", () => {
    const p = pledgeFor([laborTask("none", 0), laborTask("work", 10)], 30_00);
    expect(p.tasks.map((t) => t.label)).toEqual(["work"]);
    expect(p.laborValue).toBe(300_00);
    expect(p.contribution).toBe(37_20);
  });
});
