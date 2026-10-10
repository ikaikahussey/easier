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
    { name: "Leilani Kahale", title: "Executive Director", hours: 40, compensation: 95000 },
    { name: "Sam Ortiz", title: "Board Chair", hours: 2, compensation: 0 },
    { name: "Mei Tanaka", title: "Treasurer", hours: 2, compensation: 0 },
  ],
  employees: 7,
  volunteers: 40,
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
