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
    when: (f) => amt(f, "X.10") !== 0, reason: "Land, buildings, or equipment reported on Part X, line 10" },
  { schedule: "D", title: "Supplemental Financial Statements (Parts XI–XII)", ref: "Part IV, line 12a", forms: ["990"],
    when: (f) => f.intake.auditedFinancials, reason: "Audited financial statements" },
  { schedule: "F", title: "Activities Outside the United States", ref: "Part IV, line 14b", forms: ["990"],
    when: (f) => f.intake.foreignActivities || amt(f, "IX.3") > 0, reason: "Foreign activities over $10,000" },
  { schedule: "G", title: "Fundraising (Part I)", ref: "Part IV, line 17", forms: ["990"],
    when: (f) => amt(f, "IX.11e") > OVER(15_000), reason: "Professional fundraising fees over $15,000" },
  { schedule: "G", title: "Fundraising Events (Part II)", ref: "Part IV, line 18", forms: ["990", "990-EZ"],
    when: (f) => amt(f, "VIII.8a") > OVER(15_000), reason: "Fundraising event receipts over $15,000" },
  { schedule: "G", title: "Gaming (Part III)", ref: "Part IV, line 19", forms: ["990", "990-EZ"],
    when: (f) => amt(f, "VIII.9a") > OVER(15_000), reason: "Gaming receipts over $15,000" },
  { schedule: "I", title: "Grants to Organizations (Part II)", ref: "Part IV, line 21", forms: ["990"],
    when: (f) => amt(f, "IX.1") > OVER(5_000), reason: "Grants to domestic organizations total over $5,000; confirm any single grantee received over $5,000" },
  { schedule: "I", title: "Grants to Individuals (Part III)", ref: "Part IV, line 22", forms: ["990"],
    when: (f) => amt(f, "IX.2") > OVER(5_000), reason: "Assistance to domestic individuals over $5,000" },
  { schedule: "J", title: "Compensation Information", ref: "Part IV, line 23", forms: ["990"],
    when: (f) => f.intake.highComp, reason: "Listed person over $150,000 or former officer reported" },
  { schedule: "L", title: "Transactions With Interested Persons", ref: "Part IV, lines 25–28", forms: ["990", "990-EZ"],
    when: (f) => f.intake.interestedTransactions, reason: "Transactions with interested persons" },
  { schedule: "M", title: "Noncash Contributions", ref: "Part IV, line 29", forms: ["990"],
    when: (f) => f.intake.noncashOver25000, reason: "Noncash contributions over $25,000" },
  { schedule: "R", title: "Related Organizations", ref: "Part IV, lines 33–34", forms: ["990"],
    when: (f) => f.intake.relatedOrganizations, reason: "Related organizations" },
  { schedule: "O", title: "Supplemental Information", ref: "Required for all Form 990 filers", forms: ["990"],
    when: () => true, reason: "Always required with Form 990" },
];

export interface RequiredSchedule {
  schedule: string;
  title: string;
  ref: string;
  reason: string;
}

export function requiredSchedules(formType: FormType, facts: Facts): RequiredSchedule[] {
  return SCHEDULE_TRIGGERS.filter((t) => t.forms.includes(formType) && t.when(facts)).map(
    ({ schedule, title, ref, reason }) => ({ schedule, title, ref, reason }),
  );
}
