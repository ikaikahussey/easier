import { toDollars, type Cents } from "@/core/money";
import type { BuildInput } from "@/core/product";
import type { Finding } from "@/core/rules";
import { lineAmount } from "@/domains/nonprofit/ledger";
import { EZ_LABELS, NONPROFIT_CATALOG } from "@/domains/nonprofit/lines";
import type { Form990Data } from "./index";
import type { Form990Intake } from "./intake";
import { columnTotals } from "./allocation";
import type { HeaderOut } from "./parts/header";
import type { PartIVOut } from "./parts/part-iv";
import type { PartVOut } from "./parts/part-v";
import type { PartVIIOut } from "./parts/part-vii";
import type { PartXIOut } from "./parts/part-xi-xii";

/**
 * The complete return as line-numbered data, in whole dollars, for entry into
 * filing software or a bulk-upload template. Every figure comes from the same
 * draft the reviewer approved.
 */

const d$ = (c: Cents | undefined) => (c === undefined ? undefined : toDollars(c));

export interface ReturnExport {
  form: Form990Data["formType"];
  taxYear: { begin: string; end: string };
  organization: Record<string, unknown>;
  partI: Record<string, unknown>;
  partIII: unknown;
  partIV?: unknown;
  partV?: unknown;
  partVI?: unknown;
  partVII?: unknown;
  partVIII?: Record<string, number>;
  partIX?: unknown;
  partX?: Record<string, number>;
  partXI?: unknown;
  partXII?: unknown;
  ez?: { lines: Record<string, number>; partV: Record<string, unknown>; partVI: Record<string, unknown> };
  schedules: { required: Form990Data["schedules"]; detail: Record<string, unknown> };
  scheduleO: Form990Data["scheduleO"];
  form8879TE: Record<string, unknown>;
  review: { findings: Finding[]; approvedWithErrors: boolean };
}

export function exportReturn(d: Form990Data, input: BuildInput<Form990Intake>, findings: Finding[] = []): ReturnExport {
  const i = input.intake;
  const ledger = d.ledger;
  const t = columnTotals(d.functional);
  const header = d.parts?.H0 as HeaderOut | undefined;
  const vii = d.parts?.VII as PartVIIOut | undefined;
  const xi = d.parts?.XI as PartXIOut | undefined;
  const v = d.parts?.V as PartVOut | undefined;
  const iv = d.parts?.IV as PartIVOut | undefined;
  const prior = input.prior[0];
  const contributions = d$(["VIII.1a", "VIII.1b", "VIII.1c", "VIII.1d", "VIII.1e", "VIII.1f"].reduce((s, c) => s + lineAmount(ledger, c), 0));
  const investment = d$(lineAmount(ledger, "VIII.3") + lineAmount(ledger, "VIII.6a") + lineAmount(ledger, "VIII.7d"));
  const salaries = d$(["IX.5", "IX.6", "IX.7", "IX.8", "IX.9", "IX.10"].reduce((s, c) => s + lineAmount(ledger, c), 0));

  const organization = {
    name: input.org.name,
    dba: i.dba,
    ein: input.org.ein,
    address: { street: i.street, city: i.city, state: i.state, zip: i.zip },
    phone: i.phone,
    website: input.org.website,
    principalOfficer: { name: i.principalOfficer, address: i.principalOfficerAddress },
    itemB: header?.boxes ?? [],
    itemG_grossReceipts: d$(d.grossReceipts),
    itemH_groupExemptionNumber: i.groupExemptionNumber,
    itemI_exemptStatus: { "501c3": "501(c)(3)", "501c4": "501(c)(4)", "501c6": "501(c)(6)", "501c7": "501(c)(7)", other: "501(c)" }[i.subsection],
    itemK_formOfOrganization: i.orgForm,
    itemL_yearOfFormation: i.yearFormed,
    itemM_stateOfLegalDomicile: i.domicileState,
    accountingMethod: i.accountingMethod === "other" ? i.accountingMethodOther : i.accountingMethod,
  };

  const partI = {
    "1_mission": d.mission,
    "2_discontinuedOperations": !!i.finalReturn || !!i.disposedOver25,
    "3_votingMembers": i.votingMembers,
    "4_independentVotingMembers": i.independentMembers,
    "5_employees": i.employees,
    "6_volunteers": i.volunteers,
    "7a_unrelatedBusinessRevenue": i.unrelatedGrossIncome ?? 0,
    "7b_unrelatedBusinessTaxableIncome": undefined,
    "8_contributions": { priorYear: undefined, currentYear: contributions },
    "9_programServiceRevenue": { currentYear: d$(lineAmount(ledger, "VIII.2")) },
    "10_investmentIncome": { currentYear: investment },
    "11_otherRevenue": { currentYear: d$(d.totalRevenue - (lineAmount(ledger, "VIII.2") + lineAmount(ledger, "VIII.3") + lineAmount(ledger, "VIII.6a") + lineAmount(ledger, "VIII.7d")) - ["VIII.1a", "VIII.1b", "VIII.1c", "VIII.1d", "VIII.1e", "VIII.1f"].reduce((s, c) => s + lineAmount(ledger, c), 0)) },
    "12_totalRevenue": { priorYear: d$(prior?.totalRevenue), currentYear: d$(d.totalRevenue) },
    "13_grantsPaid": { currentYear: d$(lineAmount(ledger, "IX.1") + lineAmount(ledger, "IX.2") + lineAmount(ledger, "IX.3")) },
    "14_benefitsToMembers": { currentYear: d$(lineAmount(ledger, "IX.4")) },
    "15_salariesAndBenefits": { currentYear: salaries },
    "16a_professionalFundraisingFees": { currentYear: d$(lineAmount(ledger, "IX.11e")) },
    "16b_totalFundraisingExpenses": d$(t.fundraising),
    "17_otherExpenses": { currentYear: d$(d.totalExpenses - lineAmount(ledger, "IX.1") - lineAmount(ledger, "IX.2") - lineAmount(ledger, "IX.3") - lineAmount(ledger, "IX.4") - ["IX.5", "IX.6", "IX.7", "IX.8", "IX.9", "IX.10"].reduce((s, c) => s + lineAmount(ledger, c), 0) - lineAmount(ledger, "IX.11e")) },
    "18_totalExpenses": { priorYear: d$(prior?.totalExpenses), currentYear: d$(d.totalExpenses) },
    "19_revenueLessExpenses": { currentYear: d$(d.totalRevenue - d.totalExpenses) },
    "20_totalAssets": { beginning: d$(prior?.totalAssets), end: d$(ledger.totals.assets) },
    "21_totalLiabilities": { end: d$(ledger.totals.liabilities) },
    "22_netAssets": { beginning: d$(ledger.totals.beginningNetAssets), end: d$(ledger.totals.assets - ledger.totals.liabilities) },
  };

  const partVIII = Object.fromEntries(
    NONPROFIT_CATALOG.lines.filter((l) => l.code.startsWith("VIII.") && lineAmount(ledger, l.code) !== 0).map((l) => [l.code.slice(5), toDollars(lineAmount(ledger, l.code))]),
  );
  partVIII["12_total"] = toDollars(d.totalRevenue);
  const partX = Object.fromEntries(
    NONPROFIT_CATALOG.lines.filter((l) => l.code.startsWith("X.") && lineAmount(ledger, l.code) !== 0).map((l) => [l.code.slice(2), toDollars(lineAmount(ledger, l.code))]),
  );
  partX["16_totalAssets"] = toDollars(ledger.totals.assets);
  partX["26_totalLiabilities"] = toDollars(ledger.totals.liabilities);
  partX["32_totalNetAssets"] = toDollars(ledger.totals.assets - ledger.totals.liabilities);

  const ezLines: Record<string, number> = {};
  if (d.formType === "990-EZ") {
    for (const l of NONPROFIT_CATALOG.lines) {
      const a = lineAmount(ledger, l.code);
      if (a) ezLines[`${l.ez.slice(3)}_${EZ_LABELS[l.ez] ?? l.ez}`] = (ezLines[`${l.ez.slice(3)}_${EZ_LABELS[l.ez] ?? l.ez}`] ?? 0) + toDollars(a);
    }
    ezLines["9_totalRevenue"] = toDollars(d.totalRevenue);
    ezLines["17_totalExpenses"] = toDollars(d.totalExpenses);
    ezLines["18_excessOrDeficit"] = toDollars(d.totalRevenue - d.totalExpenses);
    ezLines["19_netAssetsBeginning"] = toDollars(ledger.totals.beginningNetAssets);
    ezLines["21_netAssetsEnd"] = toDollars(ledger.totals.assets - ledger.totals.liabilities);
    ezLines["25_totalAssetsEnd"] = toDollars(ledger.totals.assets);
    ezLines["26_totalLiabilitiesEnd"] = toDollars(ledger.totals.liabilities);
  }

  const totalRevenue = d$(d.totalRevenue);
  return {
    form: d.formType,
    taxYear: d.taxYear,
    organization,
    partI,
    partIII: { mission: d.mission, programs: d.programs.map((p) => ({ ...p, expenses: toDollars(p.expenses) })), totalProgramExpenses: d$(t.program) },
    partIV: iv?.lines.map(({ line, answer, schedule }) => ({ line, answer, schedule })),
    partV: v && { ...v, answers: pick(i, PART_V_KEYS) },
    partVI: pick(i, PART_VI_KEYS),
    partVII: vii && {
      sectionA: vii.people.map((p) => ({ ...p, reportable: toDollars(p.reportable), related: toDollars(p.related), other: toDollars(p.other) })),
      line1b: { reportable: toDollars(vii.line1b.reportable), related: toDollars(vii.line1b.related), other: toDollars(vii.line1b.other) },
      line2: vii.line2, line3: vii.line3, line4: vii.line4, line5: vii.line5,
      sectionB: vii.contractors.map((c) => ({ ...c, amount: toDollars(c.amount) })),
      sectionB_line2: vii.contractorsOver100k,
    },
    partVIII,
    partIX: d.formType === "990" ? {
      rows: d.functional.map((r) => ({ line: r.code.slice(3), label: r.label, total: toDollars(r.total), program: toDollars(r.program), management: toDollars(r.management), fundraising: toDollars(r.fundraising) })),
      "25_total": { total: toDollars(t.total), program: toDollars(t.program), management: toDollars(t.management), fundraising: toDollars(t.fundraising) },
    } : undefined,
    partX,
    partXI: xi && Object.fromEntries(Object.entries(xi).map(([k, v]) => [k, typeof v === "number" ? toDollars(v) : v])),
    partXII: pick(i, ["accountingMethod", "compiledOrReviewed", "auditedFinancials", "statementBasis", "auditCommittee", "singleAuditRequired", "singleAuditCompleted"]),
    ez: d.formType === "990-EZ" ? { lines: ezLines, partV: ezPartV(i, d), partVI: ezPartVI(i, vii) } : undefined,
    schedules: { required: d.schedules, detail: d.scheduleDetail ?? {} },
    scheduleO: d.scheduleO,
    form8879TE: {
      organizationName: input.org.name,
      ein: input.org.ein,
      taxYearEnd: input.period,
      returnType: d.formType === "990-N" ? "Form 990-N is filed through IRS.gov or an approved provider; no Form 8879-TE" : `Form ${d.formType}`,
      partI: d.formType === "990" ? { "1a": true, "1b_totalRevenue": totalRevenue } : d.formType === "990-EZ" ? { "2a": true, "2b_totalRevenue": totalRevenue } : {},
      officer: { name: i.principalOfficer },
      ero: "Entered by the ERO: EFIN, five-digit PIN, and the officer's PIN or authorization",
    },
    review: { findings, approvedWithErrors: findings.some((f) => f.severity === "error") },
  };
}

const PART_V_KEYS: (keyof Form990Intake)[] = ["forms1096Count", "formsW2GCount", "backupWithholding", "employmentReturnsFiled", "unrelatedGrossIncome", "form990TFiled", "foreignAccountsFbar", "foreignAccountCountry", "taxShelterParty", "taxShelterNotified", "form8886TFiled", "nondeductibleSolicitations", "nondeductibleStatement", "quidProQuoOver75", "quidProQuoNotified", "forms8282Count", "personalBenefitContractReceived", "personalBenefitContractPaid", "form8899Required", "form8899Filed", "form1098CRequired", "form1098CFiled", "dafExcessHoldings", "dafTaxableDistributions", "dafDistributionsToDonor", "clubInitiationFees", "clubPublicUseReceipts", "coopMemberIncome", "coopOtherIncome", "indoorTanning", "form720Filed", "section4960", "section4968", "proxyTaxNotice"];
const PART_VI_KEYS: (keyof Form990Intake)[] = ["votingMembers", "independentMembers", "familyRelationships", "relationshipsDescription", "managementCompany", "managementCompanyDescription", "governingDocChanges", "governingDocChangesDescription", "assetDiversion", "assetDiversionDescription", "hasMembers", "membersElect", "membersApprove", "membersDescription", "minutesKept", "committeeMinutes", "unreachableOfficer", "unreachableOfficerDescription", "localChapters", "chapterPolicies", "boardCopyBeforeFiling", "formReviewProcess", "conflictPolicy", "annualDisclosure", "conflictMonitoring", "whistleblowerPolicy", "documentRetentionPolicy", "compensationProcess", "otherOfficerCompProcess", "compProcessDescription", "jointVenture", "jointVenturePolicy", "statesFiled", "documentsAvailability", "booksCustodianName", "booksCustodianAddress", "booksCustodianPhone"];

function pick(i: Form990Intake, keys: (keyof Form990Intake)[]) {
  return Object.fromEntries(keys.filter((k) => i[k] !== undefined).map((k) => [k, i[k]]));
}

/** Form 990-EZ Part V (lines 33–46) from the same answers. */
function ezPartV(i: Form990Intake, d: Form990Data) {
  return {
    "33_significantActivityChange": false,
    "34_governingDocChanges": !!i.governingDocChanges,
    "35a_unrelatedBusinessIncomeOver1000": (i.unrelatedGrossIncome ?? 0) >= 1000,
    "35b_form990TFiled": i.form990TFiled,
    "35c_proxyTax": !!i.proxyTaxNotice,
    "36_liquidationOrDisposition": !!i.finalReturn || !!i.disposedOver25,
    "37a_politicalExpenditures": i.politicalExpenditures ?? 0,
    "37b_form1120POLFiled": undefined,
    "38a_loansToOrFromOfficers": (i.interested ?? []).some((t) => t.kind === "loan_to" || t.kind === "loan_from"),
    "38b_loanBalance": (i.interested ?? []).filter((t) => t.kind === "loan_to" || t.kind === "loan_from").reduce((s, t) => s + (t.balanceDue ?? 0), 0),
    "39a_clubInitiationFees": i.subsection === "501c7" ? i.clubInitiationFees : undefined,
    "39b_clubPublicUseReceipts": i.subsection === "501c7" ? i.clubPublicUseReceipts : undefined,
    "40b_excessBenefitTransaction": (i.interested ?? []).some((t) => t.kind === "excess_benefit"),
    "40e_prohibitedTaxShelter": !!i.taxShelterParty,
    "41_statesFiled": i.statesFiled,
    "42a_booksCustodian": [i.booksCustodianName, i.booksCustodianAddress, i.booksCustodianPhone].filter(Boolean).join(", "),
    "42b_foreignFinancialAccount": !!i.foreignAccountsFbar,
    "42c_foreignOffice": !!i.foreignOffices,
    "44a_donorAdvisedFunds": !!i.donorAdvisedFunds,
    "44b_hospital": !!i.hospital,
    "44c_indoorTanning": !!i.indoorTanning,
    "45a_controlledEntity": !!i.controlledEntity,
    "45b_controlledEntityTransactions": !!i.controlledEntityTransactions,
    "46_politicalCampaignActivities": !!i.politicalCampaign,
    schedulesRequired: d.schedules.map((s) => s.schedule),
  };
}

/** Form 990-EZ Part VI (lines 47–52), 501(c)(3) organizations only. */
function ezPartVI(i: Form990Intake, vii: PartVIIOut | undefined) {
  if (i.subsection !== "501c3") return {};
  return {
    "47_lobbying": !!i.lobbying,
    "48_school": !!i.isSchool || i.charityStatus === "school",
    "49a_transfersToNoncharitable": !!i.transfersToNoncharitable,
    "50_employeesOver100k": vii?.people.filter((p) => p.position === "highest_compensated" && p.reportable + p.related > 100_000_00).map((p) => ({ name: p.name, title: p.title, hours: p.hours, compensation: toDollars(p.reportable), other: toDollars(p.other) })) ?? [],
    "51_contractorsOver100k": vii?.contractors.map((c) => ({ ...c, amount: toDollars(c.amount) })) ?? [],
    "52_scheduleA": true,
  };
}

