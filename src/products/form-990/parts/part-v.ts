import { fields } from "@/core/render";
import { amt, cents, defineSchedule, usd, yesNo } from "../schedules/common";

/** Form 990 Part V: Statements Regarding Other IRS Filings and Tax Compliance. */

export interface PartVIntake {
  forms1096Count?: number;
  formsW2GCount?: number;
  backupWithholding?: boolean;
  employmentReturnsFiled?: boolean;
  unrelatedGrossIncome?: number;
  form990TFiled?: boolean;
  foreignAccountCountry?: string;
  taxShelterParty?: boolean;
  taxShelterNotified?: boolean;
  form8886TFiled?: boolean;
  nondeductibleSolicitations?: boolean;
  nondeductibleStatement?: boolean;
  quidProQuoOver75?: boolean;
  quidProQuoNotified?: boolean;
  forms8282Count?: number;
  personalBenefitContractReceived?: boolean;
  personalBenefitContractPaid?: boolean;
  form8899Required?: boolean;
  form8899Filed?: boolean;
  form1098CRequired?: boolean;
  form1098CFiled?: boolean;
  dafExcessHoldings?: boolean;
  dafTaxableDistributions?: boolean;
  dafDistributionsToDonor?: boolean;
  clubInitiationFees?: number;
  clubPublicUseReceipts?: number;
  coopMemberIncome?: number;
  coopOtherIncome?: number;
  indoorTanning?: boolean;
  form720Filed?: boolean;
  section4960?: boolean;
  section4968?: boolean;
  proxyTaxNotice?: boolean;
}

export interface PartVOut {
  line1a: number;
  line1b: number;
  line2a: number;
  line3a: boolean;
  line4a: boolean;
  line6a: boolean;
  line7a: boolean;
  line15: boolean;
  line16: boolean;
}

export const partV = defineSchedule<PartVOut>({
  schedule: "V",
  title: "Statements Regarding Other IRS Filings and Tax Compliance",
  intake: [
    {
      title: "Other IRS filings and tax compliance",
      help: "Form 990 Part V. Counts come from the organization's information returns for the calendar year that ends within the tax year.",
      collapsible: true,
      fields: [
        { name: "forms1096Count", type: "number", label: "Number of Forms 1099 and similar reported on Form 1096, box 3 (0 if none)", min: 0 },
        { name: "formsW2GCount", type: "number", label: "Number of Forms W-2G (gambling winnings) included above (0 if none)", min: 0 },
        { name: "backupWithholding", type: "yesno", label: "Did the organization comply with backup withholding rules for reportable payments to vendors and gaming winnings?" },
        { name: "employmentReturnsFiled", type: "yesno", label: "Did it file all required federal employment tax returns (Forms 941, 940, W-2)?" },
        { name: "unrelatedGrossIncome", type: "money", label: "Gross income from unrelated business activities this year ($)" },
        { name: "form990TFiled", type: "yesno", label: "If $1,000 or more: has Form 990-T been filed for this year?" },
        { name: "foreignAccountCountry", type: "text", label: "If it has a foreign financial account: name of the foreign country" },
        { name: "taxShelterParty", type: "yesno", label: "Was it a party to a prohibited tax shelter transaction?" },
        { name: "taxShelterNotified", type: "yesno", label: "Did a taxable party notify it that it was a party to a prohibited tax shelter transaction?" },
        { name: "form8886TFiled", type: "yesno", label: "If yes to either: did it file Form 8886-T?" },
        { name: "nondeductibleSolicitations", type: "yesno", label: "Non-501(c)(3) only: are gross receipts normally over $100,000 and did it solicit contributions that are not tax deductible?" },
        { name: "nondeductibleStatement", type: "yesno", label: "If so: did every solicitation state that contributions were not deductible?" },
        { name: "quidProQuoOver75", type: "yesno", label: "501(c)(3) only: did it receive a payment over $75 made partly as a contribution and partly for goods or services (for example, event tickets)?" },
        { name: "quidProQuoNotified", type: "yesno", label: "If so: did it notify the donor of the value of the goods or services?" },
        { name: "forms8282Count", type: "number", label: "Number of Forms 8282 filed (sale of donated property within three years) (0 if none)", min: 0 },
        { name: "personalBenefitContractReceived", type: "yesno", label: "Did it receive funds, directly or indirectly, to pay premiums on a personal benefit contract?" },
        { name: "personalBenefitContractPaid", type: "yesno", label: "Did it pay premiums, directly or indirectly, on a personal benefit contract?" },
        { name: "form8899Required", type: "yesno", label: "Did it receive a contribution of qualified intellectual property?" },
        { name: "form8899Filed", type: "yesno", label: "If so: did it file Form 8899?" },
        { name: "form1098CRequired", type: "yesno", label: "Did it receive a contribution of a car, boat, airplane, or other vehicle?" },
        { name: "form1098CFiled", type: "yesno", label: "If so: did it file Form 1098-C?" },
        { name: "dafExcessHoldings", type: "yesno", label: "Donor advised fund sponsors: did any fund have excess business holdings?" },
        { name: "dafTaxableDistributions", type: "yesno", label: "Donor advised fund sponsors: did it make any taxable distributions under section 4966?" },
        { name: "dafDistributionsToDonor", type: "yesno", label: "Donor advised fund sponsors: did it distribute to a donor, donor advisor, or related person?" },
        { name: "clubInitiationFees", type: "money", label: "501(c)(7) only: initiation fees and capital contributions included in Part VIII line 12 ($)" },
        { name: "clubPublicUseReceipts", type: "money", label: "501(c)(7) only: gross receipts from public use of club facilities ($)" },
        { name: "coopMemberIncome", type: "money", label: "501(c)(12) only: gross income from members or shareholders ($)" },
        { name: "coopOtherIncome", type: "money", label: "501(c)(12) only: gross income from other sources ($)" },
        { name: "indoorTanning", type: "yesno", label: "Did it receive payments for indoor tanning services?" },
        { name: "form720Filed", type: "yesno", label: "If so: did it file Form 720 to report the tax?" },
        { name: "section4960", type: "yesno", label: "Did it pay any employee more than $1,000,000, or an excess parachute payment (section 4960 tax)?" },
        { name: "section4968", type: "yesno", label: "Is it an educational institution subject to the section 4968 excise tax on net investment income?" },
        { name: "proxyTaxNotice", type: "yesno", label: "501(c)(4), (5), or (6) only: is it subject to the section 6033(e) notice and reporting requirements for lobbying and political dues?" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    return {
      line1a: i.forms1096Count ?? 0,
      line1b: i.formsW2GCount ?? 0,
      line2a: i.employees,
      line3a: cents(i.unrelatedGrossIncome) >= 1_000_00,
      line4a: !!i.foreignAccountsFbar,
      line6a: !!i.nondeductibleSolicitations,
      line7a: !!i.quidProQuoOver75,
      line15: !!i.section4960,
      line16: !!i.section4968,
    };
  },

  rules: [
    {
      id: "v.answered",
      severity: "error",
      ref: "Part V, lines 1a–2b",
      description: "The information-return counts and employment-return answers are given",
      check: ({ facts: { intake: i } }) =>
        i.forms1096Count === undefined || i.backupWithholding === undefined || i.employmentReturnsFiled === undefined
          ? "Answer Part V lines 1a–2b (Forms 1096, backup withholding, employment tax returns)"
          : undefined,
    },
    {
      id: "v.employment_returns",
      severity: "error",
      ref: "Part V, line 2b",
      description: "Employment tax returns are filed when there are employees",
      check: ({ facts: { intake: i } }) =>
        i.employees > 0 && i.employmentReturnsFiled === false ? "The organization has employees but reports not filing required employment tax returns; resolve before filing" : undefined,
    },
    {
      id: "v.ubi_990t",
      severity: "error",
      ref: "Part V, lines 3a–3b",
      description: "Form 990-T is filed when unrelated business gross income is $1,000 or more",
      check: ({ out, facts: { intake: i } }) =>
        out.line3a && !i.form990TFiled ? `Unrelated business gross income of ${usd(cents(i.unrelatedGrossIncome))} requires Form 990-T, which this service does not prepare` : undefined,
    },
    {
      id: "v.gaming_w2g",
      severity: "warning",
      ref: "Part V, line 1b",
      description: "Gaming organizations usually file Forms W-2G",
      check: ({ out, facts }) =>
        amt(facts, "VIII.9a") > 0 && out.line1b === 0 ? "Gaming income is reported but no Forms W-2G; confirm no winnings required reporting" : undefined,
    },
    {
      id: "v.quid_pro_quo",
      severity: "warning",
      ref: "Part V, lines 7a–7b",
      description: "Fundraising event tickets are quid pro quo contributions",
      check: ({ facts: { intake: i } }) =>
        i.subsection === "501c3" && (i.events ?? []).some((e) => (e.contributions ?? 0) > 0) && !i.quidProQuoOver75
          ? "Event tickets with a contribution portion are usually quid pro quo payments over $75 (line 7a); confirm the answer and that donors were told the value of benefits (line 7b)"
          : undefined,
    },
    {
      id: "v.foreign_country",
      severity: "error",
      ref: "Part V, line 4b",
      description: "A foreign financial account names its country",
      check: ({ out, facts: { intake: i } }) => (out.line4a && !i.foreignAccountCountry ? "Name the country of the foreign financial account (line 4b) and confirm FinCEN Form 114 was filed" : undefined),
    },
    {
      id: "v.followups",
      severity: "warning",
      ref: "Part V",
      description: "Yes answers have their follow-up",
      check: ({ facts: { intake: i } }) =>
        [
          (i.taxShelterParty || i.taxShelterNotified) && i.form8886TFiled === undefined && "Line 5c: answer whether Form 8886-T was filed",
          i.nondeductibleSolicitations && i.nondeductibleStatement === undefined && "Line 6b: answer whether solicitations included the non-deductibility statement",
          i.quidProQuoOver75 && i.quidProQuoNotified === undefined && "Line 7b: answer whether donors were notified of the value of goods or services",
          i.form8899Required && i.form8899Filed === undefined && "Line 7g: answer whether Form 8899 was filed",
          i.form1098CRequired && i.form1098CFiled === undefined && "Line 7h: answer whether Form 1098-C was filed",
          i.indoorTanning && i.form720Filed === undefined && "Line 14b: answer whether Form 720 was filed",
        ].filter((m): m is string => !!m),
    },
    {
      id: "v.excise",
      severity: "error",
      ref: "Part V, lines 15–16",
      description: "Section 4960 or 4968 tax requires Form 4720",
      check: ({ out }) => (out.line15 || out.line16 ? "Yes on line 15 or 16 requires Form 4720, which this service does not prepare" : undefined),
    },
  ],

  render(out, f) {
    const i = f.intake;
    return [
      fields("part-v", "Part V: Other IRS Filings and Tax Compliance", [
        ["1a Forms reported on Form 1096", out.line1a],
        ["1b Forms W-2G", out.line1b],
        ["1c Backup withholding complied", yesNo(i.backupWithholding)],
        ["2a Employees on Form W-3", out.line2a],
        ["2b Employment tax returns filed", yesNo(i.employmentReturnsFiled)],
        ["3a Unrelated business gross income ≥ $1,000", yesNo(out.line3a)],
        ["3b Form 990-T filed", out.line3a ? yesNo(i.form990TFiled) : "—"],
        ["4a Foreign financial account", yesNo(out.line4a)],
        ["4b Country", i.foreignAccountCountry],
        ["5a Party to a prohibited tax shelter transaction", yesNo(i.taxShelterParty ?? false)],
        ["5b Notified by a taxable party", yesNo(i.taxShelterNotified ?? false)],
        ["5c Form 8886-T filed", i.taxShelterParty || i.taxShelterNotified ? yesNo(i.form8886TFiled) : "—"],
        ["6a Non-deductible solicitations", yesNo(out.line6a)],
        ["6b Non-deductibility statement included", out.line6a ? yesNo(i.nondeductibleStatement) : "—"],
        ["7a Quid pro quo payments over $75", yesNo(out.line7a)],
        ["7b Donors notified of value", out.line7a ? yesNo(i.quidProQuoNotified) : "—"],
        ["7c Form 8282 required", yesNo((i.forms8282Count ?? 0) > 0)],
        ["7d Forms 8282 filed", i.forms8282Count ?? 0],
        ["7e Funds received for a personal benefit contract", yesNo(i.personalBenefitContractReceived ?? false)],
        ["7f Premiums paid on a personal benefit contract", yesNo(i.personalBenefitContractPaid ?? false)],
        ["7g Form 8899 filed (intellectual property)", i.form8899Required ? yesNo(i.form8899Filed) : "N/A"],
        ["7h Form 1098-C filed (vehicles)", i.form1098CRequired ? yesNo(i.form1098CFiled) : "N/A"],
        ["8 Donor advised fund excess business holdings", i.donorAdvisedFunds ? yesNo(i.dafExcessHoldings ?? false) : "N/A"],
        ["9a Taxable distributions (section 4966)", i.donorAdvisedFunds ? yesNo(i.dafTaxableDistributions ?? false) : "N/A"],
        ["9b Distributions to a donor, advisor, or related person", i.donorAdvisedFunds ? yesNo(i.dafDistributionsToDonor ?? false) : "N/A"],
        ["10a 501(c)(7) initiation fees and capital contributions", i.subsection === "501c7" ? usd(cents(i.clubInitiationFees)) : "N/A"],
        ["10b 501(c)(7) receipts from public use of facilities", i.subsection === "501c7" ? usd(cents(i.clubPublicUseReceipts)) : "N/A"],
        ["11a 501(c)(12) income from members", i.coopMemberIncome === undefined ? "N/A" : usd(cents(i.coopMemberIncome))],
        ["11b 501(c)(12) income from other sources", i.coopOtherIncome === undefined ? "N/A" : usd(cents(i.coopOtherIncome))],
        ["12a Section 4947(a)(1) trust filing in lieu of Form 1041", "No"],
        ["13a 501(c)(29) qualified health plan issuer", "No"],
        ["14a Indoor tanning services", yesNo(i.indoorTanning ?? false)],
        ["14b Form 720 filed", i.indoorTanning ? yesNo(i.form720Filed) : "—"],
        ["15 Section 4960 tax (compensation over $1,000,000 or excess parachute)", yesNo(out.line15)],
        ["16 Section 4968 tax (educational institution investment income)", yesNo(out.line16)],
        ["17 Section 501(c)(21) trust", "N/A"],
      ]),
    ];
  },
});
