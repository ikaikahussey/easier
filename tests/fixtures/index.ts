import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptyOverrides, type BuildInput } from "@/core/product";
import { parseTrialBalance } from "@/core/ledger/trial-balance";
import type { Form990Intake } from "@/products/form-990/intake";

export const csv = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

export const intake990: Form990Intake = {
  subsection: "501c3",
  privateFoundation: false,
  mission: "Provide after-school learning and college access for youth.",
  programs: [
    { name: "After-school learning", description: "Daily tutoring for grades 3–8.", beneficiaries: "220 students", share: 70 },
    { name: "College access", description: "Advising and scholarships for graduating seniors.", share: 30 },
  ],
  officers: [
    { name: "Leilani Kahale", title: "Executive Director", position: "officer", hours: 40, compensation: 95000, otherCompensation: 9000 },
    { name: "Sam Ortiz", title: "Board Chair", position: "director", hours: 2, compensation: 0 },
    { name: "Mei Tanaka", title: "Treasurer", position: "officer", hours: 2, compensation: 0 },
    ...["Keoni Lum", "Rosa Diaz", "Tom Nakamura", "Ana Souza", "Jin Park", "Maile Kai", "Dan Reyes", "Lea Wong"].map((name) => ({
      name, title: "Director", position: "director" as const, hours: 1, compensation: 0,
    })),
  ],
  employees: 7,
  volunteers: 40,
  unrelatedCompensation: false,
  contractors: [],
  // Heading
  street: "1234 Kalihi St",
  city: "Honolulu",
  state: "HI",
  zip: "96819",
  phone: "808-555-0100",
  principalOfficer: "Leilani Kahale",
  yearFormed: 2012,
  domicileState: "HI",
  orgForm: "corporation",
  accountingMethod: "accrual",
  // Part IV other activities: all No
  donorAdvisedFunds: false, conservationEasements: false, collections: false, escrowOrCustodial: false, endowment: false,
  uncertainTaxPositions: false, consolidatedAudit: false, isSchool: false, foreignOffices: false, hospital: false,
  bondsOver100k: false, priorExcessBenefit: false, artContributions: false, disposedOver25: false, disregardedEntity: false,
  controlledEntity: false, transfersToNoncharitable: false, partnershipActivities: false,
  // Part V
  forms1096Count: 3, formsW2GCount: 0, backupWithholding: true, employmentReturnsFiled: true, unrelatedGrossIncome: 0,
  quidProQuoOver75: true, quidProQuoNotified: true, forms8282Count: 0,
  // Part VI (continued)
  managementCompany: false, governingDocChanges: false, assetDiversion: false, hasMembers: false, membersElect: false,
  membersApprove: false, committeeMinutes: true, unreachableOfficer: false, localChapters: false, boardCopyBeforeFiling: true,
  annualDisclosure: true, otherOfficerCompProcess: true, compProcessDescription: "The board reviewed comparable salary data and approved compensation in minutes.",
  jointVenture: false, statesFiled: "HI", booksCustodianName: "Mei Tanaka", booksCustodianAddress: "1234 Kalihi St, Honolulu, HI 96819", booksCustodianPhone: "808-555-0100",
  // Parts XI–XII
  compiledOrReviewed: false, singleAuditRequired: false,
  votingMembers: 9,
  independentMembers: 9,
  familyRelationships: false,
  minutesKept: true,
  conflictPolicy: true,
  conflictMonitoring: "Directors sign annual disclosure statements reviewed by the Governance Committee.",
  whistleblowerPolicy: true,
  documentRetentionPolicy: false,
  compensationProcess: true,
  formReviewProcess: "The Finance Committee reviews the draft and the full board receives it before filing.",
  documentsAvailability: "own_website",
  contributorOver5000: true,
  lobbying: false,
  politicalCampaign: false,
  auditedFinancials: false,
  noncashOver25000: false,
  highComp: false,
  interestedTransactions: false,
  relatedOrganizations: false,
  foreignActivities: false,
  programPct: 75,
  managementPct: 15,
  fundraisingPct: 10,
  // Schedule A: hand-checked in tests/schedules.test.ts
  charityStatus: "publicly_supported",
  exemptSinceYear: 2012,
  priorPublicSupportPct: 71.2,
  supportHistory: [
    { year: 2021, contributions: 300000, relatedReceipts: 40000, investmentIncome: 1000 },
    { year: 2022, contributions: 340000, relatedReceipts: 40000, investmentIncome: 1000 },
    { year: 2023, contributions: 380000, relatedReceipts: 40000, investmentIncome: 1000 },
    { year: 2024, contributions: 410000, relatedReceipts: 40000, investmentIncome: 1000 },
  ],
  // Schedule B
  contributors: [
    { name: "Ana Lee", address: "1 Pali Hwy, Honolulu, HI 96813", kind: "individual", amount: 10000, fiveYearTotal: 60000 },
    { name: "Hale Foundation", address: "2 Bishop St, Honolulu, HI 96813", kind: "foundation", amount: 150000, fiveYearTotal: 500000 },
    { name: "Ben Cho", address: "3 King St, Honolulu, HI 96817", kind: "individual", amount: 7000 },
    { name: "State of Hawaii", kind: "government", amount: 90000 },
  ],
  // Schedule G: the gala booked as $30,000 of event revenue and $9,000 of event expenses
  events: [{ name: "Annual Gala", grossReceipts: 30000, contributions: 18000, food: 6000, rent: 3000 }],
  // Schedule I Part III
  grantRecords: true,
  grantMonitoring: "Scholarships are paid directly to colleges after enrollment is verified.",
  grantsToIndividuals: [{ type: "College scholarships", recipients: 12, cash: 12000 }],
};

export function input990(
  file = "tb-990.csv",
  patch: Partial<BuildInput<Form990Intake>> = {},
): BuildInput<Form990Intake> {
  return {
    org: { name: "Kōkua Learning Center", ein: "99-1234567", state: "HI", website: "https://example.org" },
    period: "2025-12-31",
    intake: intake990,
    documents: { trial_balance: parseTrialBalance(csv(file)) },
    overrides: emptyOverrides(),
    prior: [],
    ...patch,
  };
}
