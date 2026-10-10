import type { FormSpec } from "@/core/fields";

export const YES_NO_SCHEDULE_TRIGGERS = [
  { name: "contributorOver5000", label: "Did any single donor give $5,000 or more (cash or property) this year?" },
  { name: "lobbying", label: "Did the organization spend money or staff time on lobbying?" },
  { name: "politicalCampaign", label: "Did the organization participate in any political campaign for or against a candidate?" },
  { name: "auditedFinancials", label: "Were this year's financial statements audited by an independent accountant?" },
  { name: "noncashOver25000", label: "Did the organization receive more than $25,000 in non-cash contributions?" },
  { name: "highComp", label: "Did any officer, director, or key employee receive more than $150,000 in total compensation, or is a former officer being reported?" },
  { name: "interestedTransactions", label: "Any loans, grants, or business transactions with officers, directors, key employees, or their family members?" },
  { name: "relatedOrganizations", label: "Does the organization control or is it controlled by another tax-exempt or taxable entity?" },
  { name: "foreignActivities", label: "Did the organization have more than $10,000 of revenue or expenses from activities outside the United States?" },
] as const;

export const FORM_990_INTAKE: FormSpec = [
  {
    title: "Organization",
    fields: [
      {
        name: "subsection",
        type: "select",
        label: "Tax-exempt status",
        required: true,
        options: [
          { value: "501c3", label: "501(c)(3) public charity" },
          { value: "501c4", label: "501(c)(4) social welfare" },
          { value: "501c6", label: "501(c)(6) business league" },
          { value: "501c7", label: "501(c)(7) social club" },
          { value: "other", label: "Other 501(c)" },
        ],
      },
      { name: "privateFoundation", type: "yesno", label: "Is the organization a private foundation?", required: true },
      { name: "mission", type: "textarea", label: "Mission statement", required: true, maxLength: 1000 },
    ],
  },
  {
    title: "Programs",
    help: "Your three largest programs. Shares of program spending must total 100%.",
    fields: [
      {
        name: "programs",
        type: "list",
        label: "Programs",
        rows: 3,
        required: true,
        fields: [
          { name: "name", type: "text", label: "Program name", required: true },
          { name: "description", type: "textarea", label: "What it does and what it achieved this year", required: true },
          { name: "beneficiaries", type: "text", label: "People or groups served (with counts if known)" },
          { name: "share", type: "percent", label: "Share of program spending (%)", required: true },
        ],
      },
    ],
  },
  {
    title: "People",
    help: "List every officer, director, and trustee, including unpaid volunteers.",
    fields: [
      {
        name: "officers",
        type: "list",
        label: "Officers, directors, and key employees",
        rows: 8,
        required: true,
        fields: [
          { name: "name", type: "text", label: "Name", required: true },
          { name: "title", type: "text", label: "Title", required: true },
          { name: "hours", type: "number", label: "Average hours per week", required: true, min: 0, max: 168 },
          { name: "compensation", type: "money", label: "Reportable compensation ($)", required: true },
        ],
      },
      { name: "employees", type: "number", label: "Number of W-2 employees", required: true, min: 0 },
      { name: "volunteers", type: "number", label: "Approximate number of volunteers", min: 0 },
    ],
  },
  {
    title: "Board and governance",
    fields: [
      { name: "votingMembers", type: "number", label: "Number of voting board members", required: true, min: 0 },
      { name: "independentMembers", type: "number", label: "Number of independent voting board members", required: true, min: 0 },
      { name: "familyRelationships", type: "yesno", label: "Do any officers or directors have a family or business relationship with each other?", required: true },
      { name: "minutesKept", type: "yesno", label: "Does the board keep written minutes of its meetings?", required: true },
      { name: "conflictPolicy", type: "yesno", label: "Does the organization have a written conflict-of-interest policy?", required: true },
      { name: "conflictMonitoring", type: "textarea", label: "If yes: how is the conflict policy monitored and enforced?" },
      { name: "whistleblowerPolicy", type: "yesno", label: "Does the organization have a written whistleblower policy?", required: true },
      { name: "documentRetentionPolicy", type: "yesno", label: "Does the organization have a written document retention and destruction policy?", required: true },
      { name: "compensationProcess", type: "yesno", label: "Was the executive's compensation approved by independent board members, with documentation?", required: true },
      { name: "formReviewProcess", type: "textarea", label: "How will the board review this return before it is filed?", required: true },
      {
        name: "documentsAvailability",
        type: "select",
        label: "How does the organization make its governing documents and financial statements available to the public?",
        required: true,
        options: [
          { value: "own_website", label: "Own website" },
          { value: "upon_request", label: "Upon request" },
          { value: "other_website", label: "Another organization's website" },
          { value: "other", label: "Other" },
        ],
      },
    ],
  },
  {
    title: "Activities",
    help: "These answers determine which schedules the return needs.",
    fields: YES_NO_SCHEDULE_TRIGGERS.map((q) => ({ ...q, type: "yesno" as const, required: true })),
  },
  {
    title: "Shared cost allocation",
    help: "How staff time is split. Used to allocate salaries, rent, and other shared costs across program, management, and fundraising. Must total 100%.",
    fields: [
      { name: "programPct", type: "percent", label: "Program (%)", required: true },
      { name: "managementPct", type: "percent", label: "Management and general (%)", required: true },
      { name: "fundraisingPct", type: "percent", label: "Fundraising (%)", required: true },
    ],
  },
];

export interface Form990Intake {
  subsection: "501c3" | "501c4" | "501c6" | "501c7" | "other";
  privateFoundation: boolean;
  mission: string;
  programs: { name: string; description: string; beneficiaries?: string; share: number }[];
  officers: { name: string; title: string; hours: number; compensation: number }[];
  employees: number;
  volunteers?: number;
  votingMembers: number;
  independentMembers: number;
  familyRelationships: boolean;
  minutesKept: boolean;
  conflictPolicy: boolean;
  conflictMonitoring?: string;
  whistleblowerPolicy: boolean;
  documentRetentionPolicy: boolean;
  compensationProcess: boolean;
  formReviewProcess: string;
  documentsAvailability: "own_website" | "upon_request" | "other_website" | "other";
  contributorOver5000: boolean;
  lobbying: boolean;
  politicalCampaign: boolean;
  auditedFinancials: boolean;
  noncashOver25000: boolean;
  highComp: boolean;
  interestedTransactions: boolean;
  relatedOrganizations: boolean;
  foreignActivities: boolean;
  programPct: number;
  managementPct: number;
  fundraisingPct: number;
}
