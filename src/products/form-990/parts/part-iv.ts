import { table } from "@/core/render";
import { amt, defineSchedule } from "../schedules/common";

/**
 * Form 990 Part IV: Checklist of Required Schedules. Each line is answered from
 * the schedule triggers (which read the books and the intake) or from a direct
 * question; the answer and the schedule it points to are listed for review.
 */

export interface PartIVIntake {
  donorAdvisedFunds?: boolean;
  conservationEasements?: boolean;
  collections?: boolean;
  escrowOrCustodial?: boolean;
  endowment?: boolean;
  uncertainTaxPositions?: boolean;
  consolidatedAudit?: boolean;
  isSchool?: boolean;
  foreignOffices?: boolean;
  hospital?: boolean;
  hospitalAuditAttached?: boolean;
  bondsOver100k?: boolean;
  bondProceedsInvested?: boolean;
  bondEscrow?: boolean;
  bondOnBehalf?: boolean;
  priorExcessBenefit?: boolean;
  artContributions?: boolean;
  disposedOver25?: boolean;
  disregardedEntity?: boolean;
  controlledEntity?: boolean;
  controlledEntityTransactions?: boolean;
  transfersToNoncharitable?: boolean;
  partnershipActivities?: boolean;
}

export interface ChecklistLine {
  line: string;
  question: string;
  answer: boolean;
  schedule: string;
  source: "books" | "answer" | "derived";
}

export interface PartIVOut {
  lines: ChecklistLine[];
  /** Schedules or parts the return needs that this service does not prepare. */
  unprepared: string[];
}

const UNPREPARED: Record<string, string> = {
  "D-I": "Schedule D Part I (donor advised funds)",
  "D-II": "Schedule D Part II (conservation easements)",
  "D-III": "Schedule D Part III (collections)",
  "D-IV": "Schedule D Part IV (escrow and custodial arrangements)",
  "D-V": "Schedule D Part V (endowment funds)",
  H: "Schedule H (hospitals)",
  K: "Schedule K (tax-exempt bonds)",
  "R-VI": "Schedule R Part VI (unrelated partnerships)",
};

export const partIV = defineSchedule<PartIVOut>({
  schedule: "IV",
  title: "Checklist of Required Schedules",
  intake: [
    {
      title: "Other activities and holdings",
      help: "These complete the Part IV checklist. Most small organizations answer No to all of them.",
      collapsible: true,
      fields: [
        { name: "donorAdvisedFunds", type: "yesno", label: "Does the organization maintain donor advised funds or similar accounts?" },
        { name: "conservationEasements", type: "yesno", label: "Does it hold conservation easements?" },
        { name: "collections", type: "yesno", label: "Does it maintain collections of works of art, historical treasures, or similar assets?" },
        { name: "escrowOrCustodial", type: "yesno", label: "Does it hold amounts in escrow or as a custodian for others, or provide credit counseling or debt management services?" },
        { name: "endowment", type: "yesno", label: "Does it hold donor-restricted endowments or board-designated (quasi-) endowments?" },
        { name: "uncertainTaxPositions", type: "yesno", label: "Do the audited financial statements include a footnote on uncertain tax positions (ASC 740 / FIN 48)?" },
        { name: "consolidatedAudit", type: "yesno", label: "Was the organization included in consolidated audited financial statements?" },
        { name: "isSchool", type: "yesno", label: "Is the organization a school (section 170(b)(1)(A)(ii))?" },
        { name: "foreignOffices", type: "yesno", label: "Did it maintain an office, employees, or agents outside the United States?" },
        { name: "hospital", type: "yesno", label: "Did it operate one or more hospital facilities?" },
        { name: "hospitalAuditAttached", type: "yesno", label: "If a hospital: are audited financial statements attached?" },
        { name: "bondsOver100k", type: "yesno", label: "Did it have tax-exempt bonds over $100,000 outstanding at year end that were issued after December 31, 2002?" },
        { name: "bondProceedsInvested", type: "yesno", label: "If bonds: were proceeds invested beyond a temporary period exception?" },
        { name: "bondEscrow", type: "yesno", label: "If bonds: did it maintain an escrow account other than a refunding escrow to defease bonds?" },
        { name: "bondOnBehalf", type: "yesno", label: "If bonds: did it act as an 'on behalf of' issuer?" },
        { name: "priorExcessBenefit", type: "yesno", label: "Is it aware of an excess benefit transaction from a prior year that was not reported on a prior Form 990?" },
        { name: "artContributions", type: "yesno", label: "Did it receive contributions of art, historical treasures, or qualified conservation contributions?" },
        { name: "disposedOver25", type: "yesno", label: "Did it sell, exchange, dispose of, or transfer more than 25% of its net assets?" },
        { name: "disregardedEntity", type: "yesno", label: "Does it own 100% of a disregarded entity (for example, a single-member LLC)?" },
        { name: "controlledEntity", type: "yesno", label: "Does it have a controlled entity under section 512(b)(13)?" },
        { name: "controlledEntityTransactions", type: "yesno", label: "If so: did it receive payments from or engage in transactions with the controlled entity?" },
        { name: "transfersToNoncharitable", type: "yesno", label: "501(c)(3) only: did it transfer funds to an exempt non-charitable related organization?" },
        { name: "partnershipActivities", type: "yesno", label: "Did it conduct more than 5% of its activities through a partnership that is not a related organization?" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const has = (part: string) => f.parts.has(part);
    const sched = (letter: string) => f.requiredLetters.has(letter);
    const c3 = i.subsection === "501c3";
    const foreignGrantsOrgs = (i.foreignGrants ?? []).some((g) => !g.individuals && (g.cash + (g.noncash ?? 0)) > 5000);
    const foreignGrantsInd = (i.foreignGrants ?? []).some((g) => g.individuals && (g.cash + (g.noncash ?? 0)) > 5000);
    const vii = f.outputs.VII as { line3: boolean; line4: boolean; line5: boolean } | undefined;

    const L = (line: string, question: string, answer: boolean, schedule: string, source: ChecklistLine["source"] = "answer"): ChecklistLine =>
      ({ line, question, answer, schedule, source });

    const lines: ChecklistLine[] = [
      L("1", "Described in section 501(c)(3) or 4947(a)(1), other than a private foundation", c3, "Schedule A", "derived"),
      L("2", "Required to complete Schedule B, Schedule of Contributors", sched("B"), "Schedule B", "derived"),
      L("3", "Political campaign activities", !!i.politicalCampaign, "Schedule C, Part I"),
      L("4", "Lobbying activities, or a section 501(h) election in effect", !!i.lobbying || !!i.elected501h, "Schedule C, Part II"),
      L("5", "Section 501(c)(4), (5), or (6) subject to the section 6033(e) proxy tax notice", ["501c4", "501c6"].includes(i.subsection) && !!i.proxyTaxNotice, "Schedule C, Part III"),
      L("6", "Donor advised funds or similar accounts", !!i.donorAdvisedFunds, "Schedule D, Part I"),
      L("7", "Conservation easements", !!i.conservationEasements, "Schedule D, Part II"),
      L("8", "Collections of works of art, historical treasures, or similar assets", !!i.collections, "Schedule D, Part III"),
      L("9", "Escrow or custodial amounts, or credit counseling and debt management services", !!i.escrowOrCustodial, "Schedule D, Part IV"),
      L("10", "Donor-restricted endowments or quasi-endowments", !!i.endowment, "Schedule D, Part V"),
      L("11a", "Land, buildings, and equipment on Part X, line 10", has("D-VI"), "Schedule D, Part VI", "books"),
      L("11b", "Investments in other securities of 5% or more of total assets", has("D-VII"), "Schedule D, Part VII", "books"),
      L("11c", "Program-related investments of 5% or more of total assets", has("D-VIII"), "Schedule D, Part VIII", "books"),
      L("11d", "Other assets of 5% or more of total assets", has("D-IX"), "Schedule D, Part IX", "books"),
      L("11e", "Other liabilities on Part X, line 25", amt(f, "X.25") !== 0, "Schedule D, Part X", "books"),
      L("11f", "Financial statements include a footnote on uncertain tax positions", !!i.uncertainTaxPositions, "Schedule D, Part X"),
      L("12a", "Separate, independent audited financial statements", !!i.auditedFinancials, "Schedule D, Parts XI and XII"),
      L("12b", "Included in consolidated, independent audited financial statements", !!i.consolidatedAudit, "Schedule D, Parts XI and XII (optional)"),
      L("13", "A school described in section 170(b)(1)(A)(ii)", sched("E"), "Schedule E", "derived"),
      L("14a", "Office, employees, or agents outside the United States", !!i.foreignOffices, "—"),
      L("14b", "Aggregate revenues or expenses over $10,000 from activities outside the United States, or foreign investments of $100,000 or more", !!i.foreignActivities, "Schedule F, Parts I and IV"),
      L("15", "Grants or assistance of more than $5,000 to a foreign organization", foreignGrantsOrgs, "Schedule F, Parts II and IV", "derived"),
      L("16", "Grants or assistance of more than $5,000 to foreign individuals", foreignGrantsInd, "Schedule F, Parts III and IV", "derived"),
      L("17", "Professional fundraising expenses over $15,000", has("G-I"), "Schedule G, Part I", "books"),
      L("18", "Fundraising event contributions and gross income over $15,000", has("G-II"), "Schedule G, Part II", "books"),
      L("19", "Gaming gross income over $15,000", has("G-III"), "Schedule G, Part III", "books"),
      L("20a", "Operated one or more hospital facilities", !!i.hospital, "Schedule H"),
      L("20b", "If a hospital: audited financial statements attached", !!i.hospitalAuditAttached, "Schedule H"),
      L("21", "More than $5,000 of grants to any domestic organization or government", has("I-II") && (i.grantsToOrgs ?? []).length > 0, "Schedule I, Parts I and II", "derived"),
      L("22", "More than $5,000 of grants or assistance to domestic individuals", has("I-III"), "Schedule I, Parts I and III", "books"),
      L("23", "Yes to Part VII, Section A, line 3, 4, or 5", !!(vii?.line3 || vii?.line4 || vii?.line5), "Schedule J", "derived"),
      L("24a", "Tax-exempt bonds over $100,000 outstanding, issued after December 31, 2002", !!i.bondsOver100k, "Schedule K"),
      L("24b", "If bonds: proceeds invested beyond a temporary period exception", !!i.bondProceedsInvested, "Schedule K"),
      L("24c", "If bonds: escrow account other than a refunding escrow", !!i.bondEscrow, "Schedule K"),
      L("24d", "If bonds: acted as an 'on behalf of' issuer", !!i.bondOnBehalf, "Schedule K"),
      L("25a", "Excess benefit transaction with a disqualified person this year", (i.interested ?? []).some((t) => t.kind === "excess_benefit"), "Schedule L, Part I", "derived"),
      L("25b", "Aware of a prior-year excess benefit transaction not previously reported", !!i.priorExcessBenefit, "Schedule L, Part I"),
      L("26", "Loans to or from interested persons outstanding at year end", (i.interested ?? []).some((t) => t.kind === "loan_to" || t.kind === "loan_from"), "Schedule L, Part II", "derived"),
      L("27", "Grants or assistance to interested persons", (i.interested ?? []).some((t) => t.kind === "grant"), "Schedule L, Part III", "derived"),
      L("28a", "Business transactions with a current or former officer, director, trustee, key employee, creator, founder, or substantial contributor", (i.interested ?? []).some((t) => t.kind === "business" && !/family|35%|entity/i.test(t.relationship)), "Schedule L, Part IV", "derived"),
      L("28b", "Business transactions with a family member of such a person", (i.interested ?? []).some((t) => t.kind === "business" && /family|spouse|child|parent|sibling/i.test(t.relationship)), "Schedule L, Part IV", "derived"),
      L("28c", "Business transactions with a 35% controlled entity of such a person", (i.interested ?? []).some((t) => t.kind === "business" && /35%|entity|owned|company/i.test(t.relationship)), "Schedule L, Part IV", "derived"),
      L("29", "More than $25,000 in noncash contributions", !!i.noncashOver25000, "Schedule M"),
      L("30", "Contributions of art, historical treasures, or qualified conservation contributions", !!i.artContributions, "Schedule M"),
      L("31", "Liquidated, terminated, or dissolved and ceased operations", !!i.finalReturn, "Schedule N, Part I"),
      L("32", "Sold, exchanged, disposed of, or transferred more than 25% of net assets", !!i.disposedOver25, "Schedule N, Part II"),
      L("33", "Owned 100% of a disregarded entity", !!i.disregardedEntity, "Schedule R, Part I"),
      L("34", "Related to any tax-exempt or taxable entity", !!i.relatedOrganizations, "Schedule R, Parts II–IV and Part V line 1"),
      L("35a", "Controlled entity under section 512(b)(13)", !!i.controlledEntity, "—"),
      L("35b", "If so: payments from or transactions with the controlled entity", !!i.controlledEntityTransactions, "Schedule R, Part V line 2"),
      L("36", "501(c)(3): transfers to an exempt non-charitable related organization", c3 && !!i.transfersToNoncharitable, "Schedule R, Part V line 2"),
      L("37", "More than 5% of activities through an unrelated partnership", !!i.partnershipActivities, "Schedule R, Part VI"),
      L("38", "Completed Schedule O with explanations for Part VI lines 11b and 19", true, "Schedule O", "derived"),
    ];
    const unprepared = [...f.parts, ...f.requiredLetters].filter((p) => p in UNPREPARED).map((p) => UNPREPARED[p]!);
    return { lines, unprepared: [...new Set(unprepared)] };
  },

  rules: [
    {
      id: "iv.unprepared",
      severity: "error",
      ref: "Part IV",
      description: "Every schedule the checklist requires is prepared",
      check: ({ out }) => out.unprepared.map((u) => `The return requires ${u}, which this service does not prepare; it must be completed by the reviewer`),
    },
    {
      id: "iv.consistency",
      severity: "warning",
      ref: "Part IV, lines 20b, 24b–24d, 35b",
      description: "Follow-up lines agree with their lead questions",
      check: ({ facts: { intake: i } }) =>
        [
          !i.hospital && i.hospitalAuditAttached && "Line 20b answered without a hospital on line 20a",
          !i.bondsOver100k && (i.bondProceedsInvested || i.bondEscrow || i.bondOnBehalf) && "Lines 24b–24d answered without bonds on line 24a",
          !i.controlledEntity && i.controlledEntityTransactions && "Line 35b answered without a controlled entity on line 35a",
        ].filter((m): m is string => !!m),
    },
  ],

  render(out) {
    return [
      table(
        "part-iv",
        "Part IV: Checklist of Required Schedules",
        [["line", "Line"], ["question", "Question"], ["answer", "Answer"], ["schedule", "If Yes, complete"], ["source", "Source"]],
        out.lines.map((l) => ({ line: l.line, question: l.question, answer: l.answer ? "Yes" : "No", schedule: l.schedule, source: l.source === "books" ? "Books" : l.source === "derived" ? "Derived" : "Client" })),
        { note: out.unprepared.length ? `Not prepared here: ${out.unprepared.join("; ")}.` : undefined },
      ),
    ];
  },
});
