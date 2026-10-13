import { fields } from "@/core/render";
import { defineSchedule, yesNo } from "../schedules/common";

/**
 * Form 990 heading, items A–M (and the Form 990-N e-Postcard fields):
 * address, year of formation, legal domicile, form of organization, accounting
 * method, principal officer, and the return-type boxes.
 */

export const ORG_FORMS = [
  { value: "corporation", label: "Corporation" },
  { value: "trust", label: "Trust" },
  { value: "association", label: "Unincorporated association" },
  { value: "other", label: "Other" },
] as const;

export const ACCOUNTING_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "accrual", label: "Accrual" },
  { value: "other", label: "Other" },
] as const;

export interface HeaderIntake {
  yearFormed: number;
  domicileState: string;
  orgForm: (typeof ORG_FORMS)[number]["value"];
  accountingMethod: (typeof ACCOUNTING_METHODS)[number]["value"];
  accountingMethodOther?: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  principalOfficer: string;
  principalOfficerAddress?: string;
  dba?: string;
  groupExemptionNumber?: string;
  amendedReturn?: boolean;
  initialReturn?: boolean;
  finalReturn?: boolean;
  nameChange?: boolean;
  addressChange?: boolean;
  applicationPending?: boolean;
}

export interface HeaderOut {
  /** Tax years completed before this one. */
  priorYears: number;
  boxes: string[];
}

export const header = defineSchedule<HeaderOut>({
  schedule: "H0",
  title: "Heading",
  intake: [
    {
      title: "Organization",
      help: "Printed at the top of the return.",
      fields: [
        { name: "street", type: "text", label: "Street address (or P.O. box)", required: true },
        { name: "city", type: "text", label: "City", required: true },
        { name: "state", type: "text", label: "State", required: true, maxLength: 2 },
        { name: "zip", type: "text", label: "ZIP code", required: true, maxLength: 10 },
        { name: "phone", type: "text", label: "Telephone number", required: true, maxLength: 20 },
        { name: "principalOfficer", type: "text", label: "Name of principal officer", required: true },
        { name: "principalOfficerAddress", type: "text", label: "Principal officer's address, if different from the organization's" },
        { name: "yearFormed", type: "number", label: "Year of formation", required: true, min: 1800, max: 2100 },
        { name: "domicileState", type: "text", label: "State of legal domicile", required: true, maxLength: 2 },
        { name: "orgForm", type: "select", label: "Form of organization", required: true, options: ORG_FORMS },
        { name: "accountingMethod", type: "select", label: "Accounting method", required: true, options: ACCOUNTING_METHODS },
        { name: "accountingMethodOther", type: "text", label: "If other: describe the accounting method" },
        { name: "dba", type: "text", label: "Doing business as (if any)" },
        { name: "groupExemptionNumber", type: "text", label: "Group exemption number (if any)", maxLength: 4 },
        { name: "initialReturn", type: "checkbox", label: "This is the organization's first return" },
        { name: "amendedReturn", type: "checkbox", label: "This is an amended return" },
        { name: "finalReturn", type: "checkbox", label: "This is a final return (the organization terminated, liquidated, or dissolved)" },
        { name: "nameChange", type: "checkbox", label: "The organization changed its name this year" },
        { name: "addressChange", type: "checkbox", label: "The organization changed its address this year" },
        { name: "applicationPending", type: "checkbox", label: "An application for exemption is pending" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const priorYears = Math.max(0, f.taxYear - i.yearFormed);
    const boxes = [
      i.addressChange && "Address change",
      i.nameChange && "Name change",
      i.initialReturn && "Initial return",
      i.finalReturn && "Final return/terminated",
      i.amendedReturn && "Amended return",
      i.applicationPending && "Application pending",
    ].filter((b): b is string => !!b);
    return { priorYears, boxes };
  },

  rules: [
    {
      id: "h.accounting_other",
      severity: "error",
      ref: "Part XII, line 1",
      description: "An 'other' accounting method is described",
      check: ({ facts }) => (facts.intake.accountingMethod === "other" && !facts.intake.accountingMethodOther ? "Describe the accounting method (reported on Schedule O)" : undefined),
    },
    {
      id: "h.final_return_schedule_n",
      severity: "info",
      ref: "Heading, item B; Part IV line 31",
      description: "A final return requires Schedule N",
      check: ({ facts }) => (facts.intake.finalReturn ? "Final return: Schedule N Part I must be completed and the organization's exemption closes" : undefined),
    },
    {
      id: "h.formed_before_period",
      severity: "error",
      ref: "Heading, item L",
      description: "Year of formation is not after the tax year",
      check: ({ facts }) => (facts.intake.yearFormed > facts.taxYear ? `Year of formation ${facts.intake.yearFormed} is after the tax year ${facts.taxYear}` : undefined),
    },
  ],

  render(out, f) {
    const i = f.intake;
    return [
      fields("heading", "Heading", [
        ["Name", f.org.name],
        ["Doing business as", i.dba],
        ["EIN", f.org.ein],
        ["Address", `${i.street}, ${i.city}, ${i.state} ${i.zip}`],
        ["Telephone", i.phone],
        ["Website", f.org.website],
        ["Principal officer (item F)", [i.principalOfficer, i.principalOfficerAddress].filter(Boolean).join(", ")],
        ["Return boxes (item B)", out.boxes.join(", ") || "None"],
        ["Group exemption number (item H)", i.groupExemptionNumber],
        ["Form of organization (item K)", ORG_FORMS.find((o) => o.value === i.orgForm)?.label],
        ["Year of formation (item L)", i.yearFormed],
        ["State of legal domicile (item M)", i.domicileState],
        ["Accounting method (Part XII line 1)", i.accountingMethod === "other" ? `Other: ${i.accountingMethodOther ?? ""}` : ACCOUNTING_METHODS.find((o) => o.value === i.accountingMethod)?.label],
        ["Application pending", yesNo(!!i.applicationPending)],
      ]),
    ];
  },
});
