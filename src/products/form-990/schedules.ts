import type { NonprofitLedger } from "@/domains/nonprofit/ledger";
import { lineAmount } from "@/domains/nonprofit/ledger";
import type { Form990Intake } from "./intake";
import type { FormType } from "./form-type";

interface Facts {
  intake: Form990Intake;
  ledger: NonprofitLedger;
}

interface Trigger {
  schedule: string;
  title: string;
  ref: string;
  forms: FormType[];
  when: (f: Facts) => boolean;
  reason: string;
  /** Schedule part this trigger requires, when a schedule has several (e.g. "G-II"). */
  part?: string;
}

const amt = (f: Facts, ...codes: string[]) => codes.reduce((t, c) => t + lineAmount(f.ledger, c), 0);
const OVER = (dollars: number) => dollars * 100;

/** Declarative schedule triggers; each cites the Form 990 Part IV checklist line. */
export const SCHEDULE_TRIGGERS: Trigger[] = [
  { schedule: "A", title: "Public Charity Status and Public Support", ref: "Part IV, line 1", forms: ["990", "990-EZ"],
    when: (f) => f.intake.subsection === "501c3", reason: "Organization is a 501(c)(3)" },
  { schedule: "B", title: "Schedule of Contributors", ref: "Part IV, line 2", forms: ["990", "990-EZ"],
    when: (f) => f.intake.contributorOver5000, reason: "A contributor gave $5,000 or more" },
  { schedule: "C", title: "Political Campaign and Lobbying Activities", ref: "Part IV, lines 3–4", forms: ["990", "990-EZ"],
    when: (f) => f.intake.lobbying || f.intake.politicalCampaign || amt(f, "IX.11d") > 0,
    reason: "Lobbying or political campaign activity reported" },
  { schedule: "D", title: "Supplemental Financial Statements (Part VI)", ref: "Part IV, line 11a", forms: ["990"],
    when: (f) => amt(f, "X.10") !== 0, reason: "Land, buildings, or equipment reported on Part X, line 10", part: "D-VI" },
  { schedule: "D", title: "Supplemental Financial Statements (Parts XI–XII)", ref: "Part IV, line 12a", forms: ["990"],
    when: (f) => f.intake.auditedFinancials, reason: "Audited financial statements", part: "D-XI" },
  { schedule: "F", title: "Activities Outside the United States", ref: "Part IV, line 14b", forms: ["990"],
    when: (f) => f.intake.foreignActivities || amt(f, "IX.3") > OVER(5_000),
    reason: "Activities outside the United States over $10,000, or foreign grants over $5,000" },
  { schedule: "G", title: "Fundraising (Part I)", ref: "Part IV, line 17", forms: ["990"],
    when: (f) => amt(f, "IX.11e") > OVER(15_000), reason: "Professional fundraising fees over $15,000", part: "G-I" },
  { schedule: "G", title: "Fundraising Events (Part II)", ref: "Part IV, line 18", forms: ["990", "990-EZ"],
    when: (f) => amt(f, "VIII.1c", "VIII.8a") > OVER(15_000),
    reason: "Fundraising event contributions and gross income over $15,000 (Part VIII lines 1c and 8a)", part: "G-II" },
  { schedule: "G", title: "Gaming (Part III)", ref: "Part IV, line 19", forms: ["990", "990-EZ"],
    when: (f) => amt(f, "VIII.9a") > OVER(15_000), reason: "Gaming receipts over $15,000", part: "G-III" },
  { schedule: "I", title: "Grants to Organizations (Part II)", ref: "Part IV, line 21", forms: ["990"],
    when: (f) => amt(f, "IX.1") > OVER(5_000), reason: "Grants to domestic organizations total over $5,000; confirm any single grantee received over $5,000", part: "I-II" },
  { schedule: "I", title: "Grants to Individuals (Part III)", ref: "Part IV, line 22", forms: ["990"],
    when: (f) => amt(f, "IX.2") > OVER(5_000), reason: "Assistance to domestic individuals over $5,000", part: "I-III" },
  { schedule: "J", title: "Compensation Information", ref: "Part IV, line 23", forms: ["990"],
    when: (f) =>
      f.intake.highComp ||
      f.intake.unrelatedCompensation ||
      f.intake.officers.some((o) => o.former || o.compensation + (o.relatedCompensation ?? 0) + (o.otherCompensation ?? 0) > 150_000),
    reason: "Part VII line 3, 4, or 5 is Yes: a former officer, a person over $150,000, or compensation from an unrelated organization" },
  { schedule: "L", title: "Transactions With Interested Persons", ref: "Part IV, lines 25–28", forms: ["990", "990-EZ"],
    when: (f) => f.intake.interestedTransactions, reason: "Transactions with interested persons" },
  { schedule: "M", title: "Noncash Contributions", ref: "Part IV, line 29", forms: ["990"],
    when: (f) => f.intake.noncashOver25000, reason: "Noncash contributions over $25,000" },
  { schedule: "R", title: "Related Organizations", ref: "Part IV, lines 33–34", forms: ["990"],
    when: (f) => f.intake.relatedOrganizations, reason: "Related organizations" },
  { schedule: "O", title: "Supplemental Information", ref: "Required for all Form 990 filers", forms: ["990"],
    when: () => true, reason: "Always required with Form 990" },

  // Part IV lines answered from the client's "other activities" questions and the balance sheet.
  { schedule: "D", title: "Donor Advised Funds (Part I)", ref: "Part IV, line 6", forms: ["990"],
    when: (f) => !!f.intake.donorAdvisedFunds, reason: "Maintains donor advised funds", part: "D-I" },
  { schedule: "D", title: "Conservation Easements (Part II)", ref: "Part IV, line 7", forms: ["990"],
    when: (f) => !!f.intake.conservationEasements, reason: "Holds conservation easements", part: "D-II" },
  { schedule: "D", title: "Collections of Art and Historical Treasures (Part III)", ref: "Part IV, line 8", forms: ["990"],
    when: (f) => !!f.intake.collections, reason: "Maintains collections of works of art or historical treasures", part: "D-III" },
  { schedule: "D", title: "Escrow and Custodial Arrangements (Part IV)", ref: "Part IV, line 9", forms: ["990"],
    when: (f) => !!f.intake.escrowOrCustodial, reason: "Escrow or custodial arrangements, or credit counseling services", part: "D-IV" },
  { schedule: "D", title: "Endowment Funds (Part V)", ref: "Part IV, line 10", forms: ["990"],
    when: (f) => !!f.intake.endowment, reason: "Holds donor-restricted or quasi-endowment funds", part: "D-V" },
  { schedule: "D", title: "Investments — Other Securities (Part VII)", ref: "Part IV, line 11b", forms: ["990"],
    when: (f) => amt(f, "X.12") !== 0 && Math.abs(amt(f, "X.12")) * 20 >= Math.abs(f.ledger.totals.assets),
    reason: "Other securities are 5% or more of total assets", part: "D-VII" },
  { schedule: "D", title: "Investments — Program Related (Part VIII)", ref: "Part IV, line 11c", forms: ["990"],
    when: (f) => amt(f, "X.13") !== 0 && Math.abs(amt(f, "X.13")) * 20 >= Math.abs(f.ledger.totals.assets),
    reason: "Program-related investments are 5% or more of total assets", part: "D-VIII" },
  { schedule: "D", title: "Other Assets (Part IX)", ref: "Part IV, line 11d", forms: ["990"],
    when: (f) => amt(f, "X.15") !== 0 && Math.abs(amt(f, "X.15")) * 20 >= Math.abs(f.ledger.totals.assets),
    reason: "Other assets are 5% or more of total assets", part: "D-IX" },
  { schedule: "D", title: "Other Liabilities (Part X)", ref: "Part IV, lines 11e–11f", forms: ["990"],
    when: (f) => amt(f, "X.25") !== 0 || !!f.intake.uncertainTaxPositions,
    reason: "Other liabilities on Part X line 25, or a footnote on uncertain tax positions", part: "D-X" },
  { schedule: "E", title: "Schools", ref: "Part IV, line 13", forms: ["990", "990-EZ"],
    when: (f) => !!f.intake.isSchool || f.intake.charityStatus === "school", reason: "The organization is a school" },
  { schedule: "H", title: "Hospitals", ref: "Part IV, line 20a", forms: ["990"],
    when: (f) => !!f.intake.hospital, reason: "Operates one or more hospital facilities" },
  { schedule: "K", title: "Supplemental Information on Tax-Exempt Bonds", ref: "Part IV, line 24a", forms: ["990"],
    when: (f) => !!f.intake.bondsOver100k, reason: "Tax-exempt bonds over $100,000 outstanding" },
  { schedule: "L", title: "Excess Benefit Transactions (Part I), prior year", ref: "Part IV, line 25b", forms: ["990", "990-EZ"],
    when: (f) => !!f.intake.priorExcessBenefit, reason: "Aware of an unreported prior-year excess benefit transaction", part: "L-I" },
  { schedule: "M", title: "Noncash Contributions", ref: "Part IV, line 30", forms: ["990"],
    when: (f) => !!f.intake.artContributions, reason: "Received works of art, historical treasures, or qualified conservation contributions" },
  { schedule: "N", title: "Liquidation, Termination, or Dissolution (Part I)", ref: "Part IV, line 31", forms: ["990", "990-EZ"],
    when: (f) => !!f.intake.finalReturn, reason: "Final return", part: "N-I" },
  { schedule: "N", title: "Sale, Exchange, or Disposition of Assets (Part II)", ref: "Part IV, line 32", forms: ["990", "990-EZ"],
    when: (f) => !!f.intake.disposedOver25, reason: "Disposed of more than 25% of net assets", part: "N-II" },
  { schedule: "R", title: "Disregarded Entities (Part I)", ref: "Part IV, line 33", forms: ["990"],
    when: (f) => !!f.intake.disregardedEntity, reason: "Owns a disregarded entity", part: "R-I" },
  { schedule: "R", title: "Transactions With Related Organizations (Part V)", ref: "Part IV, lines 35b–36", forms: ["990"],
    when: (f) => !!f.intake.controlledEntityTransactions || !!f.intake.transfersToNoncharitable,
    reason: "Transactions with a controlled entity, or transfers to a non-charitable related organization", part: "R-V" },
  { schedule: "R", title: "Unrelated Organizations Taxable as a Partnership (Part VI)", ref: "Part IV, line 37", forms: ["990"],
    when: (f) => !!f.intake.partnershipActivities, reason: "Conducts over 5% of activities through an unrelated partnership", part: "R-VI" },
];

export interface RequiredSchedule {
  schedule: string;
  title: string;
  ref: string;
  reason: string;
  part?: string;
}

/** Distinct schedule letters, in form order. */
export const scheduleLetters = (rows: RequiredSchedule[]) => [...new Set(rows.map((r) => r.schedule))].sort();

export function requiredSchedules(formType: FormType, facts: Facts): RequiredSchedule[] {
  return SCHEDULE_TRIGGERS.filter((t) => t.forms.includes(formType) && t.when(facts)).map(
    ({ schedule, title, ref, reason, part }) => ({ schedule, title, ref, reason, ...(part ? { part } : {}) }),
  );
}
