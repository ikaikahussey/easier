import { describe, expect, it } from "vitest";
import { buildDraft } from "@/core/draft";
import { parseTrialBalance } from "@/core/ledger/trial-balance";
import { form990, type Form990Data } from "@/products/form-990";
import { selectFormType } from "@/products/form-990/form-type";
import type { Form990Intake } from "@/products/form-990/intake";
import type { PartIVOut } from "@/products/form-990/parts/part-iv";
import type { PartVIIOut } from "@/products/form-990/parts/part-vii";
import type { PartXIOut } from "@/products/form-990/parts/part-xi-xii";
import type { ScheduleCOut } from "@/products/form-990/schedules/schedule-c";
import type { ScheduleDOut } from "@/products/form-990/schedules/schedule-d";
import type { ScheduleNOut } from "@/products/form-990/schedules/schedule-n";
import type { ScheduleROut } from "@/products/form-990/schedules/schedule-r";
import { toDollars } from "@/core/money";
import { csv, input990, intake990 } from "./fixtures";

async function draftWith(patch: Partial<Form990Intake>, tb = "tb-990.csv", tbText?: string) {
  const base = input990(tb);
  const snap = await buildDraft(form990, {
    ...base,
    intake: { ...intake990, ...patch },
    documents: tbText ? { trial_balance: parseTrialBalance(tbText) } : base.documents,
    overrides: { ...base.overrides, mappings: { "6900": "IX.24" } },
  });
  return { snap, d: snap.data as Form990Data };
}
const errors = (snap: { findings: { ruleId: string; severity: string; message: string }[] }) => snap.findings.filter((f) => f.severity === "error");
const ids = (snap: Parameters<typeof errors>[0], sev = "error") => snap.findings.filter((f) => f.severity === sev).map((f) => f.ruleId);

describe("form type for young organizations", () => {
  it("applies the $75,000 first-year and $60,000 early-years tests", () => {
    expect(selectFormType(70_000_00, 0, [], 0).formType).toBe("990-N");
    expect(selectFormType(80_000_00, 0, [], 0).formType).toBe("990-EZ");
    expect(selectFormType(70_000_00, 0, [40_000_00], 1)).toMatchObject({ formType: "990-N", usedAverage: true }); // avg 55,000
    expect(selectFormType(70_000_00, 0, [60_000_00], 1).formType).toBe("990-EZ"); // avg 65,000
    expect(selectFormType(55_000_00, 0, [50_000_00, 52_000_00], 2).formType).toBe("990-N"); // first two years: 50,000 and 52,000
    expect(selectFormType(55_000_00, 0, [50_000_00, 52_000_00], 3).formType).toBe("990-EZ"); // three-year avg 52,333 > 50,000
  });

  it("feeds the year of formation into the selection", async () => {
    // The EZ fixture has $120,000 of gross receipts: 990-EZ at any age, but a prior-year average
    // of $55,000 makes a second-year organization a 990-N filer while an older one is not.
    const prior = [{ year: 2024, totalRevenue: 0 as const }];
    const { d } = await draftWith({ yearFormed: 2024 }, "tb-ez.csv");
    expect(d.grossReceipts).toBe(120_000_00);
    expect(d.formType).toBe("990-EZ");
    const young = await buildDraft(form990, { ...input990("tb-ez.csv"), prior, intake: { ...intake990, yearFormed: 2024 } });
    expect((young.data as Form990Data).formType).toBe("990-N"); // (0 + 120,000) / 2 = 60,000
    const oldPrior = [{ year: 2024, totalRevenue: 100_000_00 }, { year: 2023, totalRevenue: 100_000_00 }];
    const old = await buildDraft(form990, { ...input990("tb-ez.csv"), prior: oldPrior, intake: { ...intake990, yearFormed: 2012 } });
    expect((old.data as Form990Data).formType).toBe("990-EZ"); // three-year average 106,667
    const oldSmall = await buildDraft(form990, { ...input990("tb-ez.csv"), prior: [{ year: 2024, totalRevenue: 0 }, { year: 2023, totalRevenue: 0 }], intake: { ...intake990, yearFormed: 2012 } });
    expect((oldSmall.data as Form990Data).formType).toBe("990-N"); // three-year average 40,000
  });
});

describe("Part IV checklist", async () => {
  const { snap, d } = await draftWith({});
  const iv = d.parts.IV as PartIVOut;
  const line = (n: string) => iv.lines.find((l) => l.line === n)!;

  it("answers from the books, the triggers, and the client", () => {
    expect(line("1").answer).toBe(true);
    expect(line("2").answer).toBe(true);
    expect(line("11a")).toMatchObject({ answer: true, source: "books" });
    expect(line("18")).toMatchObject({ answer: true, source: "books" });
    expect(line("22")).toMatchObject({ answer: true, source: "books" });
    expect(line("21").answer).toBe(false); // no single grantee over $5,000 listed
    expect(line("23").answer).toBe(false);
    expect(line("38").answer).toBe(true);
    expect(iv.lines).toHaveLength(53);
    expect(errors(snap)).toEqual([]);
  });

  it("blocks schedules this service does not prepare", async () => {
    const { snap, d } = await draftWith({ endowment: true, bondsOver100k: true });
    expect((d.parts.IV as PartIVOut).unprepared).toEqual(["Schedule D Part V (endowment funds)", "Schedule K (tax-exempt bonds)"]);
    expect(ids(snap)).toContain("part_iv.unprepared");
  });
});

describe("Part VII", async () => {
  it("totals compensation and answers lines 2–5", async () => {
    const { d } = await draftWith({});
    const vii = d.parts.VII as PartVIIOut;
    expect(vii.line1b).toEqual({ reportable: 95_000_00, related: 0, other: 9_000_00 });
    expect([vii.line2, vii.line3, vii.line4, vii.line5]).toEqual([0, false, false, false]);
  });

  it("requires the whole board and an officer", async () => {
    const { snap } = await draftWith({ officers: intake990.officers.slice(0, 3) });
    expect(errors(snap).map((f) => f.message)).toContain("Part VI reports 9 voting members but only 1 directors or trustees are listed; list every person who served at any time during the year");
    const { snap: noOfficer } = await draftWith({ officers: intake990.officers.filter((o) => o.position !== "officer") });
    expect(ids(noOfficer)).toContain("part_vii.officers_present");
  });

  it("derives Schedule J from a former officer or $150,000", async () => {
    const { d } = await draftWith({ officers: [...intake990.officers, { name: "Old ED", title: "Former Executive Director", position: "officer", former: true, hours: 0, compensation: 0 }] });
    expect((d.parts.VII as PartVIIOut).line3).toBe(true);
    expect((d.parts.IV as PartIVOut).lines.find((l) => l.line === "23")!.answer).toBe(true);
    expect(Object.keys(d.scheduleDetail)).toContain("J");
  });

  it("lists the five highest contractors over $100,000", async () => {
    const { d } = await draftWith({
      contractors: [
        { name: "Alpha", address: "1 A St", service: "IT", amount: 120000 },
        { name: "Beta", address: "2 B St", service: "Legal", amount: 90000 },
      ],
      contractorsOver100k: 1,
    });
    const vii = d.parts.VII as PartVIIOut;
    expect(vii.contractors.map((c) => c.name)).toEqual(["Alpha"]);
    expect(vii.contractorsOver100k).toBe(1);
  });
});

describe("Part XI reconciliation", async () => {
  it("ties the fixture to the cent: 225,700 + 487,500 − 471,700 = 241,500", async () => {
    const { snap, d } = await draftWith({});
    const xi = d.parts.XI as PartXIOut;
    expect([xi.line1, xi.line2, xi.line4, xi.line10, xi.partX32]).toEqual([487_500_00, 471_700_00, 225_700_00, 241_500_00, 241_500_00]);
    expect(xi.difference).toBe(0);
    expect(ids(snap)).not.toContain("part_xi.reconciles");
  });

  it("flags an unexplained difference and accepts an adjustment", async () => {
    // A trial balance whose equity is $4,000 higher than beginning net assets plus net income (a direct-to-equity entry).
    const tb = csv("tb-990.csv").replace('3000,Net Assets Without Donor Restrictions,Equity,,"200,700.00"', '3000,Net Assets Without Donor Restrictions,Equity,,"196,700.00"\n3050,Unrealized Gain Reserve,Equity,,"4,000.00"');
    const { snap } = await draftWith({}, "tb-990.csv", tb);
    // Both equity accounts count as beginning net assets, so the books still tie; the difference arises only when the TB is unbalanced.
    expect(ids(snap)).not.toContain("part_xi.reconciles");
    const unbalanced = csv("tb-990.csv").replace('1000,Operating Checking,Bank,"85,000.00",', '1000,Operating Checking,Bank,"89,000.00",');
    const off = await draftWith({}, "tb-990.csv", unbalanced);
    expect(errors(off.snap).find((f) => f.ruleId === "part_xi.reconciles")?.message).toBe(
      "Part XI line 10 is $241,500 but assets less liabilities is $245,500: $4,000 unexplained. Record it on lines 5–9 or correct the trial balance.",
    );
    const fixed = await draftWith({ netUnrealizedGains: 4000 }, "tb-990.csv", unbalanced);
    expect(ids(fixed.snap)).not.toContain("part_xi.reconciles");
    expect((fixed.d.parts.XI as PartXIOut).line10).toBe(245_500_00);
  });
});

describe("Parts V and VI", () => {
  it("requires Form 990-T above $1,000 of unrelated business income", async () => {
    const { snap } = await draftWith({ unrelatedGrossIncome: 2500 });
    expect(ids(snap)).toContain("part_v.ubi_990t");
  });

  it("requires every Part VI answer and the explanations for Yes answers", async () => {
    const { snap } = await draftWith({ managementCompany: undefined, assetDiversion: true });
    expect(errors(snap).map((f) => f.message)).toEqual(expect.arrayContaining(["Answer Part VI line 3", "Line 5: describe the diversion of assets and the corrective action"]));
  });

  it("carries governance explanations into Schedule O", async () => {
    const { d } = await draftWith({ familyRelationships: true, relationshipsDescription: "Sam Ortiz and Lea Wong are siblings." });
    expect(d.scheduleO.find((e) => e.ref === "Part VI, line 2")?.text).toBe("Sam Ortiz and Lea Wong are siblings.");
  });
});

describe("Schedules E, N, C averaging, R Part V, D Parts VII–X", () => {
  it("Schedule E requires answers and explains a No", async () => {
    const { snap } = await draftWith({ isSchool: true });
    expect(ids(snap)).toContain("sched_e.answered");
    const answered = Object.fromEntries(["eNondiscriminationInDocuments", "eNondiscriminationInMaterials", "ePolicyPublicized", "eRecordsRacialComposition", "eRecordsScholarships", "eRecordsMaterials", "eRecordsSolicitation", "eCertifies7550"].map((k) => [k, true]));
    const ok = await draftWith({ isSchool: true, ...answered, ePolicyPublicizedHow: "Website notice per Rev. Proc. 2019-22", eDiscriminationAny: false, eGovernmentAid: false, eGovernmentAidRevoked: false });
    expect(ids(ok.snap).filter((r) => r.startsWith("sched_e"))).toEqual([]);
  });

  it("Schedule N lists distributions and the dissolution questions on a final return", async () => {
    const { snap, d } = await draftWith({
      finalReturn: true,
      distributions: [{ description: "Cash and equipment", date: "2025-12-31", fairMarketValue: 241500, method: "Book value", recipient: "Hawaii Literacy, Honolulu", recipientEin: "99-0000001", recipientSection: "501(c)(3)" }],
      nOfficerBecameInsider: false, nOfficerEmployee: false, nOfficerOwner: false, nOfficerCompensated: false,
      nNotifiedState: true, nLiabilitiesPaid: true, nBondsOutstanding: false,
    });
    const n = d.scheduleDetail.N as ScheduleNOut;
    expect(n.part).toBe("I");
    expect(n.total).toBe(241_500_00);
    expect(n.pctOfNetAssets).toBe(107); // 241,500 / 225,700 beginning net assets
    expect(ids(snap).filter((r) => r.startsWith("sched_n"))).toEqual([]);
    expect((d.parts.IV as PartIVOut).lines.find((l) => l.line === "31")!.answer).toBe(true);
  });

  it("Schedule C four-year averaging applies the 150% ceilings", async () => {
    const history = [2022, 2023, 2024].map((year) => ({ year, nontaxable: 90000, totalLobbying: 100000, grassrootsNontaxable: 22500, grassroots: 10000 }));
    const { d, snap } = await draftWith({ lobbying: true, elected501h: true, directLobbying: 100000, grassrootsLobbying: 10000, lobbyingHistory: history });
    const a = (d.scheduleDetail.C as ScheduleCOut).averaging!;
    // Nontaxable: 90,000 × 3 + 94,340 = 364,340; ceiling 546,510; lobbying 410,000 → within.
    expect(a.lobbyingCeiling).toBe(546_510_00);
    expect(a.totalLobbying.reduce((t, v) => t + v, 0)).toBe(410_000_00);
    expect(a.exceeds).toBe(false);
    expect(ids(snap)).not.toContain("sched_c.four_year_ceiling");
    const over = await draftWith({ lobbying: true, elected501h: true, directLobbying: 250000, grassrootsLobbying: 0, lobbyingHistory: history.map((h) => ({ ...h, totalLobbying: 150000 })) });
    expect((over.d.scheduleDetail.C as ScheduleCOut).averaging!.exceeds).toBe(true); // 700,000 > 546,510
    expect(ids(over.snap)).toContain("sched_c.four_year_ceiling");
  });

  it("Schedule R Part V itemizes transactions over $50,000", async () => {
    const { d } = await draftWith({
      relatedOrganizations: true,
      related: [{ kind: "exempt", name: "Kōkua Foundation", activity: "Fundraising", domicile: "HI", exemptSection: "501(c)(3)" }],
      relatedTransactionList: [
        { organization: "Kōkua Foundation", type: "c", amount: 75000, method: "Cash received" },
        { organization: "Kōkua Foundation", type: "n", amount: 2000, method: "Cost" },
      ],
    });
    const r = d.scheduleDetail.R as ScheduleROut;
    expect(r.partV.line1.c).toBe(true);
    expect(r.partV.line1.n).toBe(true);
    expect(r.partV.line2.map((t) => t.amountC)).toEqual([75_000_00]);
  });

  it("Schedule D Part IX lists other assets at 5% or more of total assets", async () => {
    // Add a $50,000 right-of-use asset and matching net assets: 53,000 / 316,000 = 16.8% of total assets.
    const tb = csv("tb-990.csv").replace(',TOTAL,', '1700,Right of Use Asset,Other Asset,"50,000.00",\n3200,Net Assets Lease Reserve,Equity,,"50,000.00"\n,TOTAL,');
    const { d, snap } = await draftWith({}, "tb-990.csv", tb);
    const ix = (d.scheduleDetail.D as ScheduleDOut).partIX!;
    expect(ix.rows.map((r) => r.description)).toEqual(["Security Deposit", "Right of Use Asset"]);
    expect(ix.total).toBe(53_000_00);
    expect(ix.partX).toBe(53_000_00);
    expect((d.parts.IV as PartIVOut).lines.find((l) => l.line === "11d")!.answer).toBe(true);
    expect(errors(snap)).toEqual([]);
  });
});

describe("return export", () => {
  it("produces line-numbered whole-dollar data that ties to the worksheet", async () => {
    const { snap, d } = await draftWith({});
    const out = form990.export!(d, { ...input990(), intake: intake990 }, snap.findings) as import("@/products/form-990/export").ReturnExport;
    expect(out.form).toBe("990");
    expect(out.organization).toMatchObject({ ein: "99-1234567", itemL_yearOfFormation: 2012, itemM_stateOfLegalDomicile: "HI", itemG_grossReceipts: 496500 });
    expect(out.partI).toMatchObject({ "8_contributions": { currentYear: 438000 }, "12_totalRevenue": { currentYear: 487500 }, "18_totalExpenses": { currentYear: 471700 }, "22_netAssets": { end: 241500 } });
    expect(out.partVIII!["1c"]).toBe(18000);
    expect(out.partX!["32_totalNetAssets"]).toBe(241500);
    expect((out.partIX as { "25_total": { total: number } })["25_total"].total).toBe(471700);
    expect(out.partIV).toHaveLength(53);
    expect(out.form8879TE.partI).toEqual({ "1a": true, "1b_totalRevenue": 487500 });
    expect(out.schedules.detail).toHaveProperty("A");
    expect(out.review.approvedWithErrors).toBe(false);
  });

  it("maps an EZ return onto Form 990-EZ lines", async () => {
    const { snap, d } = await draftWith({ events: [], grantsToIndividuals: [] }, "tb-ez.csv");
    const out = form990.export!(d, { ...input990("tb-ez.csv"), intake: { ...intake990, events: [], grantsToIndividuals: [] } }, snap.findings) as import("@/products/form-990/export").ReturnExport;
    expect(out.form).toBe("990-EZ");
    expect(out.ez!.lines["9_totalRevenue"]).toBe(toDollars(d.totalRevenue));
    expect(out.ez!.partV["42a_booksCustodian"]).toContain("Mei Tanaka");
    expect(out.ez!.partVI["52_scheduleA"]).toBe(true);
    expect(out.form8879TE.partI).toEqual({ "2a": true, "2b_totalRevenue": toDollars(d.totalRevenue) });
  });
});
