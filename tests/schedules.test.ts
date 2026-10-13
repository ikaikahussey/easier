import { describe, expect, it } from "vitest";
import { buildDraft } from "@/core/draft";
import { form990, type Form990Data } from "@/products/form-990";
import type { Form990Intake } from "@/products/form-990/intake";
import type { ScheduleAOut } from "@/products/form-990/schedules/schedule-a";
import type { ScheduleBOut } from "@/products/form-990/schedules/schedule-b";
import { lobbyingNontaxable, type ScheduleCOut } from "@/products/form-990/schedules/schedule-c";
import type { ScheduleDOut } from "@/products/form-990/schedules/schedule-d";
import type { ScheduleGOut } from "@/products/form-990/schedules/schedule-g";
import type { ScheduleIOut } from "@/products/form-990/schedules/schedule-i";
import type { ScheduleJOut } from "@/products/form-990/schedules/schedule-j";
import { input990, intake990 } from "./fixtures";

/**
 * Expected figures are worked by hand from tests/fixtures/tb-990.csv (tax year 2025)
 * and the fixture intake; comments show the arithmetic.
 */

async function draftWith(patch: Partial<Form990Intake>) {
  // The reviewer resolves the one unclassifiable account so only schedule findings remain.
  const base = input990();
  const snap = await buildDraft(form990, {
    ...base,
    intake: { ...intake990, ...patch },
    overrides: { ...base.overrides, mappings: { "6900": "IX.24" } },
  });
  return { snap, d: snap.data as Form990Data };
}

const findings = (snap: { findings: { ruleId: string; severity: string; message: string }[] }, sev?: string) =>
  snap.findings.filter((f) => !sev || f.severity === sev);
const ruleIds = (snap: Parameters<typeof findings>[0], sev?: string) => findings(snap, sev).map((f) => f.ruleId);

describe("event split (Schedule G Part II)", async () => {
  const { snap, d } = await draftWith({});
  const g = d.scheduleDetail.G as ScheduleGOut;

  it("moves the contribution portion of the gala from line 8a to line 1c", () => {
    expect(d.ledger.lines["VIII.1c"]).toBe(18_000_00);
    expect(d.ledger.lines["VIII.8a"]).toBe(12_000_00); // 30,000 − 18,000
    expect(d.eventSplit).toBe(18_000_00);
  });

  it("leaves total revenue and gross receipts unchanged", () => {
    expect(d.totalRevenue).toBe(487_500_00); // 496,500 gross − 9,000 event costs
    expect(d.grossReceipts).toBe(496_500_00);
  });

  it("computes the event column and ties to the books", () => {
    const c = g.events.columns[0]!;
    expect([c.grossReceipts, c.contributions, c.grossIncome, c.direct, c.net]).toEqual([30_000_00, 18_000_00, 12_000_00, 9_000_00, 3_000_00]);
    expect(ruleIds(snap)).not.toContain("sched_g.event_receipts_tie");
    expect(ruleIds(snap)).not.toContain("sched_g.event_expenses_tie");
  });

  it("triggers Part II on lines 1c plus 8a over $15,000", () => {
    expect(d.schedules.find((s) => s.part === "G-II")).toBeTruthy();
  });

  it("warns when event receipts entered do not match the books", async () => {
    const { snap } = await draftWith({ events: [{ name: "Gala", grossReceipts: 25000, contributions: 15000, food: 6000, rent: 3000 }] });
    expect(ruleIds(snap, "warning")).toContain("sched_g.event_receipts_tie");
  });
});

describe("Schedule A Part II (170(b)(1)(A)(vi))", async () => {
  const { snap, d } = await draftWith({});
  const a = (d.scheduleDetail.A as ScheduleAOut).partII!;

  it("uses four years of history plus the current year from the ledger", () => {
    // Current-year line 1: 180,000 + 150,000 + 90,000 (VIII.1f, 1f, 1e) + 18,000 event contributions (1c)
    expect(a.line1).toEqual([300_000_00, 340_000_00, 380_000_00, 410_000_00, 438_000_00]);
    expect(a.line8[4]).toBe(1_500_00);
    expect(a.line10[4]).toBe(3_000_00); // event gross income 12,000 − direct costs 9,000
    expect(a.line12[4]).toBe(45_000_00); // program fees
  });

  it("limits each non-public donor to 2% of total support", () => {
    // Line 11(f) = 1,868,000 + 5,500 + 3,000 = 1,876,500; 2% = 37,530
    const line11f = a.line11.reduce((t, v) => t + v, 0);
    expect(line11f).toBe(1_876_500_00);
    // Ana Lee 60,000 − 37,530 = 22,470; Hale Foundation 500,000 − 37,530 = 462,470; Ben Cho under; State exempt
    expect(a.excess.map((x) => [x.name, x.excess])).toEqual([["Ana Lee", 22_470_00], ["Hale Foundation", 462_470_00]]);
    expect(a.line5).toBe(484_940_00);
    expect(a.line6).toBe(1_383_060_00);
  });

  it("reports 73.70% and meets the 33⅓% test", () => {
    expect(a.line14).toBe(73.7); // 1,383,060 / 1,876,500
    expect(a.result).toBe("16a");
    expect(ruleIds(snap, "error")).toEqual([]);
  });

  it("stops at line 13 in the first five years", async () => {
    const { d } = await draftWith({ exemptSinceYear: 2022 });
    expect((d.scheduleDetail.A as ScheduleAOut).partII!.result).toBe("13");
  });

  it("requires the support history", async () => {
    const { snap } = await draftWith({ supportHistory: [] });
    expect(ruleIds(snap, "error")).toContain("sched_a.history_missing");
  });

  it("falls to the 10% facts-and-circumstances test and then fails", async () => {
    // One donor with a huge five-year total pushes public support below 33⅓%.
    const contributors = [{ name: "Big Donor", kind: "individual" as const, amount: 150000, fiveYearTotal: 1_500_000 }];
    const fc = await draftWith({ contributors, priorPublicSupportPct: 20, factsAndCircumstances: true, factsAndCircumstancesExplanation: "Broad public solicitation." });
    const p = (fc.d.scheduleDetail.A as ScheduleAOut).partII!;
    expect(p.line14).toBeLessThan(33.34);
    expect(p.line14).toBeGreaterThan(10);
    expect(p.result).toBe("17a");
    const fail = await draftWith({ contributors, priorPublicSupportPct: 20, factsAndCircumstances: false });
    expect((fail.d.scheduleDetail.A as ScheduleAOut).partII!.result).toBe("fails");
    expect(ruleIds(fail.snap, "error")).toContain("sched_a.fails_support_test");
  });

  it("blocks statuses whose parts are not prepared", async () => {
    const { snap } = await draftWith({ charityStatus: "supporting" });
    expect(ruleIds(snap, "error")).toContain("sched_a.status_unsupported");
  });
});

describe("Schedule A Part III (509(a)(2))", async () => {
  const { d } = await draftWith({
    charityStatus: "509a2",
    currentDisqualifiedAmounts: 10000,
    receiptPayors: [{ year: 2025, name: "Kalani School", amount: 20000 }],
  });
  const p = (d.scheduleDetail.A as ScheduleAOut).partIII!;

  it("puts program fees on line 2 and event income on line 3", () => {
    expect(p.line2[4]).toBe(45_000_00);
    expect(p.line3[4]).toBe(12_000_00);
    expect(p.line6).toEqual([340_000_00, 380_000_00, 420_000_00, 450_000_00, 495_000_00]);
  });

  it("excludes disqualified persons and large payers", () => {
    // 2025 line 13 = 495,000 + 1,500 = 496,500; 1% = 4,965, so the $5,000 floor applies: 20,000 − 5,000
    expect(p.line13[4]).toBe(496_500_00);
    expect(p.line7a[4]).toBe(10_000_00);
    expect(p.line7b[4]).toBe(15_000_00);
    expect(p.line8.reduce((t, v) => t + v, 0)).toBe(2_060_000_00); // 2,085,000 − 25,000
  });

  it("passes both 509(a)(2) tests", () => {
    expect(p.line15).toBe(98.54); // 2,060,000 / 2,090,500
    expect(p.line17).toBe(0); // 5,500 / 2,090,500 rounds to 0%
    expect(p.result).toBe("19a");
  });
});

describe("Schedule B", async () => {
  it("uses the special rule for 33⅓% (vi) organizations", async () => {
    const { d } = await draftWith({});
    const b = d.scheduleDetail.B as ScheduleBOut;
    expect(b.rule).toBe("special");
    expect(b.line1h).toBe(438_000_00);
    expect(b.threshold).toBe(8_760_00); // 2% of 438,000
    expect(b.listed.map((c) => c.name)).toEqual(["Ana Lee", "Hale Foundation"]); // Ben Cho (7,000) and the State are not listed
  });

  it("uses the general rule otherwise and never lists governments", async () => {
    const { d } = await draftWith({ charityStatus: "509a2" });
    const b = d.scheduleDetail.B as ScheduleBOut;
    expect(b.rule).toBe("general");
    expect(b.listed.map((c) => c.name)).toEqual(["Ana Lee", "Hale Foundation", "Ben Cho"]);
  });

  it("requires noncash details", async () => {
    const { snap, d } = await draftWith({
      contributors: [{ name: "Art Patron", address: "4 Ala Moana Blvd", kind: "individual", amount: 20000, noncash: 20000 }],
    });
    expect((d.scheduleDetail.B as ScheduleBOut).listed[0]!.person).toBe(false);
    expect(ruleIds(snap, "error")).toContain("sched_b.noncash_details");
  });
});

describe("Schedule C", () => {
  it("computes the 501(h) nontaxable amount by tier", () => {
    expect(lobbyingNontaxable(400_000_00)).toBe(80_000_00);
    expect(lobbyingNontaxable(750_000_00)).toBe(137_500_00);
    expect(lobbyingNontaxable(1_200_000_00)).toBe(195_000_00);
    expect(lobbyingNontaxable(2_000_000_00)).toBe(250_000_00);
    expect(lobbyingNontaxable(20_000_000_00)).toBe(1_000_000_00);
  });

  it("flags excess grassroots lobbying for an electing organization", async () => {
    const { snap, d } = await draftWith({ lobbying: true, elected501h: true, directLobbying: 10000, grassrootsLobbying: 30000 });
    const c = (d.scheduleDetail.C as ScheduleCOut).partIIA!;
    // Exempt purpose expenditures 471,700 → nontaxable 94,340; grassroots limit 23,585
    expect(c.exemptPurpose).toBe(471_700_00);
    expect(c.nontaxable).toBe(94_340_00);
    expect(c.grassrootsNontaxable).toBe(23_585_00);
    expect(c.grassrootsExcess).toBe(6_415_00);
    expect(ruleIds(snap, "error")).toContain("sched_c.excess_lobbying");
  });

  it("blocks political campaign activity by a 501(c)(3)", async () => {
    const { snap } = await draftWith({ politicalCampaign: true, politicalDescription: "Mailer endorsing a candidate", politicalExpenditures: 2000 });
    expect(ruleIds(snap, "error")).toContain("sched_c.political_501c3");
  });
});

describe("Schedule D", async () => {
  it("builds Part VI from the fixed asset accounts and ties to Part X", async () => {
    const { snap, d } = await draftWith({});
    const vi = (d.scheduleDetail.D as ScheduleDOut).partVI!;
    const equipment = vi.rows.find((r) => r.line === "1d")!;
    expect([equipment.cost, equipment.depreciation, equipment.book]).toEqual([30_000_00, 12_000_00, 18_000_00]);
    expect(vi.total).toBe(vi.partX);
    expect(ruleIds(snap)).not.toContain("sched_d.ppe_ties");
  });

  it("reconciles audited statements to Part I lines 12 and 18", async () => {
    // Audit includes $5,000 of donated services as both revenue and expense.
    const ok = await draftWith({
      auditedFinancials: true,
      statementBasis: "separate",
      auditCommittee: true,
      auditedRevenue: 492500,
      auditedExpenses: 476700,
      reconcilingItems: [
        { item: "rev_2b", amount: 5000 },
        { item: "exp_2a", amount: 5000 },
      ],
    });
    const xi = (ok.d.scheduleDetail.D as ScheduleDOut).partXI!;
    expect(xi.line5).toBe(487_500_00);
    expect(ruleIds(ok.snap, "error")).toEqual([]);

    const off = await draftWith({ auditedFinancials: true, auditedRevenue: 492500, auditedExpenses: 476700 });
    expect(findings(off.snap, "error").filter((f) => f.ruleId === "sched_d.reconciles").map((f) => f.message)).toEqual([
      "Part XI line 5 is $492,500 but Part I line 12 is $487,500: -$5,000 unexplained",
      "Part XII line 5 is $476,700 but Part I line 18 is $471,700: -$5,000 unexplained",
    ]);
  });
});

describe("Schedule I", async () => {
  it("ties assistance to individuals to Part IX line 2", async () => {
    const { snap, d } = await draftWith({});
    expect((d.scheduleDetail.I as ScheduleIOut).individuals[0]!.recipients).toBe(12);
    expect(ruleIds(snap)).not.toContain("sched_i.individuals_tie");
  });

  it("warns when the detail does not tie", async () => {
    const { snap } = await draftWith({ grantsToIndividuals: [{ type: "Scholarships", recipients: 10, cash: 10000 }] });
    expect(ruleIds(snap, "warning")).toContain("sched_i.individuals_tie");
  });
});

describe("Schedule J", async () => {
  const officers = [...intake990.officers.slice(1), { name: "Leilani Kahale", title: "Executive Director", position: "officer" as const, hours: 40, compensation: 160000 }];

  it("requires a breakdown for everyone over $150,000", async () => {
    const { snap } = await draftWith({ highComp: true, officers });
    expect(ruleIds(snap, "error")).toContain("sched_j.people_listed");
  });

  it("compares the breakdown with Part VII", async () => {
    const { snap, d } = await draftWith({
      highComp: true,
      officers,
      jBoardApproval: true,
      compensated: [{ name: "Leilani Kahale", title: "Executive Director", base: 150000, bonus: 5000, deferred: 8000 }],
    });
    const j = d.scheduleDetail.J as ScheduleJOut;
    expect(j.people[0]!.total).toBe(163_000_00);
    expect(ruleIds(snap, "error")).not.toContain("sched_j.people_listed");
    expect(findings(snap, "warning").find((f) => f.ruleId === "sched_j.ties_to_part_vii")?.message).toBe(
      "Leilani Kahale: Schedule J reportable compensation $155,000 differs from Part VII $160,000",
    );
  });
});

describe("Schedules L, M, R, F", async () => {
  it("require detail when triggered and render it when given", async () => {
    const empty = await draftWith({ interestedTransactions: true, noncashOver25000: true, relatedOrganizations: true, foreignActivities: true });
    expect(ruleIds(empty.snap, "error")).toEqual(expect.arrayContaining(["sched_l.listed", "sched_m.listed", "sched_r.listed", "sched_f.activities"]));

    const full = await draftWith({
      interestedTransactions: true,
      interested: [{ kind: "loan_to", person: "Sam Ortiz", relationship: "Board chair", amount: 20000, balanceDue: 12000, description: "Emergency loan", boardApproved: true, writtenAgreement: true }],
      noncashOver25000: true,
      noncash: [{ type: "9", count: 2, amount: 40000, method: "Market quote on date of gift" }],
      forms8283: 0,
      giftAcceptancePolicy: true,
      thirdPartyProcessors: false,
      relatedOrganizations: true,
      related: [{ kind: "disregarded", name: "Kōkua Properties LLC", activity: "Holds program building", domicile: "HI", income: 0, assets: 50000 }],
      foreignActivities: true,
      foreignRegions: [{ region: "East Asia and the Pacific", activity: "Program services", expenditures: 15000 }],
    });
    expect(ruleIds(full.snap, "error")).toEqual([]);
    const ids = full.snap.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["sched-l-2", "sched-m-1", "sched-r-1", "sched-f-1"]));
  });
});

describe("Form 990-EZ schedules", async () => {
  it("prepares Schedules A and B for an EZ filer", async () => {
    const base = input990("tb-ez.csv");
    const snap = await buildDraft(form990, { ...base, intake: { ...intake990, events: [], grantsToIndividuals: [] } });
    const d = snap.data as Form990Data;
    expect(d.formType).toBe("990-EZ");
    expect(Object.keys(d.scheduleDetail).sort()).toEqual(["A", "B"]);
    expect(snap.sections.map((s) => s.id)).toContain("sched-a-2c");
  });
});
