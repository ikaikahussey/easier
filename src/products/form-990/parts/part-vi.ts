import { fields } from "@/core/render";
import { defineSchedule, yesNo } from "../schedules/common";

/**
 * Form 990 Part VI: Governance, Management, and Disclosure. The core governance
 * questions are asked in the main intake; this part collects the rest and
 * produces the Schedule O explanations the Yes answers require.
 */

export interface PartVIIntake {
  relationshipsDescription?: string;
  managementCompany?: boolean;
  managementCompanyDescription?: string;
  governingDocChanges?: boolean;
  governingDocChangesDescription?: string;
  assetDiversion?: boolean;
  assetDiversionDescription?: string;
  hasMembers?: boolean;
  membersElect?: boolean;
  membersApprove?: boolean;
  membersDescription?: string;
  committeeMinutes?: boolean;
  unreachableOfficer?: boolean;
  unreachableOfficerDescription?: string;
  localChapters?: boolean;
  chapterPolicies?: boolean;
  boardCopyBeforeFiling?: boolean;
  annualDisclosure?: boolean;
  otherOfficerCompProcess?: boolean;
  compProcessDescription?: string;
  jointVenture?: boolean;
  jointVenturePolicy?: boolean;
  statesFiled?: string;
  booksCustodianName?: string;
  booksCustodianAddress?: string;
  booksCustodianPhone?: string;
}

export interface PartVIOut {
  scheduleO: { ref: string; text: string }[];
}

export const partVI = defineSchedule<PartVIOut>({
  schedule: "VI",
  title: "Governance, Management, and Disclosure",
  intake: [
    {
      title: "Governance (continued)",
      help: "The rest of Form 990 Part VI. Yes answers are explained on Schedule O, which is public.",
      collapsible: true,
      fields: [
        { name: "relationshipsDescription", type: "textarea", label: "If any officers or directors are related: who, and how (line 2)" },
        { name: "managementCompany", type: "yesno", label: "Did the organization delegate control over management duties to a management company or other person? (line 3)" },
        { name: "managementCompanyDescription", type: "text", label: "If so: who, and which duties" },
        { name: "governingDocChanges", type: "yesno", label: "Did it make significant changes to its articles or bylaws since the prior return? (line 4)" },
        { name: "governingDocChangesDescription", type: "textarea", label: "If so: describe the changes" },
        { name: "assetDiversion", type: "yesno", label: "Did it become aware of a significant diversion of its assets (theft, embezzlement, unauthorized use)? (line 5)" },
        { name: "assetDiversionDescription", type: "textarea", label: "If so: nature of the diversion, amounts, and corrective action" },
        { name: "hasMembers", type: "yesno", label: "Does it have members or stockholders? (line 6)" },
        { name: "membersElect", type: "yesno", label: "Can members, stockholders, or others elect or appoint board members? (line 7a)" },
        { name: "membersApprove", type: "yesno", label: "Are any governance decisions subject to approval by members or others outside the board? (line 7b)" },
        { name: "membersDescription", type: "text", label: "If yes to 6, 7a, or 7b: describe the classes of members and their rights" },
        { name: "committeeMinutes", type: "yesno", label: "Does each committee with authority to act for the board keep written minutes? (line 8b)" },
        { name: "unreachableOfficer", type: "yesno", label: "Is there any officer, director, trustee, or key employee who cannot be reached at the organization's mailing address? (line 9)" },
        { name: "unreachableOfficerDescription", type: "text", label: "If so: names and addresses" },
        { name: "localChapters", type: "yesno", label: "Does it have local chapters, branches, or affiliates? (line 10a)" },
        { name: "chapterPolicies", type: "yesno", label: "If so: are there written policies governing their activities? (line 10b)" },
        { name: "boardCopyBeforeFiling", type: "yesno", label: "Will every voting board member receive a complete copy of this return before it is filed? (line 11a)" },
        { name: "annualDisclosure", type: "yesno", label: "Are officers, directors, and key employees required to disclose annually interests that could give rise to conflicts? (line 12b)" },
        { name: "otherOfficerCompProcess", type: "yesno", label: "Was the compensation of other officers and key employees approved by independent persons with comparability data and documentation? (line 15b)" },
        { name: "compProcessDescription", type: "textarea", label: "Describe the compensation review process (who reviewed, what data, when)" },
        { name: "jointVenture", type: "yesno", label: "Did it invest in, contribute assets to, or participate in a joint venture with a taxable entity? (line 16a)" },
        { name: "jointVenturePolicy", type: "yesno", label: "If so: does it follow a written policy to evaluate joint ventures and safeguard its exempt status? (line 16b)" },
        { name: "statesFiled", type: "text", label: "States where a copy of this return is required to be filed (for example, HI) (line 17)" },
        { name: "booksCustodianName", type: "text", label: "Name of the person who possesses the organization's books and records (line 20)" },
        { name: "booksCustodianAddress", type: "text", label: "Address of the books and records" },
        { name: "booksCustodianPhone", type: "text", label: "Telephone number", maxLength: 20 },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const o: PartVIOut["scheduleO"] = [];
    const add = (ref: string, text?: string) => text && o.push({ ref, text: text.trim() });
    if (i.familyRelationships) add("Part VI, line 2", i.relationshipsDescription);
    if (i.managementCompany) add("Part VI, line 3", i.managementCompanyDescription);
    if (i.governingDocChanges) add("Part VI, line 4", i.governingDocChangesDescription);
    if (i.assetDiversion) add("Part VI, line 5", i.assetDiversionDescription);
    if (i.hasMembers || i.membersElect || i.membersApprove) add("Part VI, lines 6–7b", i.membersDescription);
    if (i.unreachableOfficer) add("Part VI, line 9", i.unreachableOfficerDescription);
    if (i.compensationProcess || i.otherOfficerCompProcess) add("Part VI, line 15", i.compProcessDescription);
    return { scheduleO: o };
  },

  rules: [
    {
      id: "vi.answered",
      severity: "error",
      ref: "Part VI",
      description: "Every Part VI question is answered",
      check: ({ facts: { intake: i } }) => {
        const missing = [
          i.managementCompany === undefined && "3",
          i.governingDocChanges === undefined && "4",
          i.assetDiversion === undefined && "5",
          i.hasMembers === undefined && "6",
          i.membersElect === undefined && "7a",
          i.membersApprove === undefined && "7b",
          i.committeeMinutes === undefined && "8b",
          i.unreachableOfficer === undefined && "9",
          i.localChapters === undefined && "10a",
          i.boardCopyBeforeFiling === undefined && "11a",
          i.conflictPolicy && i.annualDisclosure === undefined && "12b",
          i.otherOfficerCompProcess === undefined && "15b",
          i.jointVenture === undefined && "16a",
          !i.booksCustodianName && "20",
        ].filter((m): m is string => !!m);
        return missing.length ? `Answer Part VI line${missing.length > 1 ? "s" : ""} ${missing.join(", ")}` : undefined;
      },
    },
    {
      id: "vi.explanations",
      severity: "error",
      ref: "Schedule O",
      description: "Yes answers that require an explanation have one",
      check: ({ facts: { intake: i } }) =>
        [
          i.familyRelationships && !i.relationshipsDescription && "Line 2: describe the family or business relationships",
          i.managementCompany && !i.managementCompanyDescription && "Line 3: name the management company and the duties delegated",
          i.governingDocChanges && !i.governingDocChangesDescription && "Line 4: describe the changes to the governing documents",
          i.assetDiversion && !i.assetDiversionDescription && "Line 5: describe the diversion of assets and the corrective action",
          (i.hasMembers || i.membersElect || i.membersApprove) && !i.membersDescription && "Lines 6–7b: describe the members and their rights",
          i.unreachableOfficer && !i.unreachableOfficerDescription && "Line 9: list the names and addresses",
          i.localChapters && i.chapterPolicies === undefined && "Line 10b: answer whether written chapter policies exist",
          i.jointVenture && i.jointVenturePolicy === undefined && "Line 16b: answer whether a joint venture policy is followed",
        ].filter((m): m is string => !!m),
    },
    {
      id: "vi.asset_diversion",
      severity: "warning",
      ref: "Part VI, line 5",
      description: "A diversion of assets is a significant disclosure",
      check: ({ facts: { intake: i } }) => (i.assetDiversion ? "A significant diversion of assets is reported; confirm the Schedule O narrative with the client and counsel before filing" : undefined),
    },
    {
      id: "vi.board_copy",
      severity: "warning",
      ref: "Part VI, line 11a",
      description: "The board receives the return before filing",
      check: ({ facts: { intake: i } }) => (i.boardCopyBeforeFiling === false ? "The board will not receive a copy of the return before filing; the IRS views this as a weak governance practice" : undefined),
    },
    {
      id: "vi.states",
      severity: "warning",
      ref: "Part VI, line 17",
      description: "States requiring a copy are listed",
      check: ({ facts }) => (!facts.intake.statesFiled ? `List the states where this return must be filed (line 17); the organization is domiciled in ${facts.intake.domicileState}` : undefined),
    },
  ],

  render(out, f) {
    const i = f.intake;
    return [
      fields("part-vi-a", "Part VI, Section A: Governing Body and Management", [
        ["1a Voting members", i.votingMembers],
        ["1b Independent voting members", i.independentMembers],
        ["2 Family or business relationships among officers", yesNo(i.familyRelationships)],
        ["3 Management duties delegated", yesNo(i.managementCompany)],
        ["4 Significant changes to governing documents", yesNo(i.governingDocChanges)],
        ["5 Significant diversion of assets", yesNo(i.assetDiversion)],
        ["6 Members or stockholders", yesNo(i.hasMembers)],
        ["7a Members elect board members", yesNo(i.membersElect)],
        ["7b Decisions subject to member approval", yesNo(i.membersApprove)],
        ["8a Board meetings documented", yesNo(i.minutesKept)],
        ["8b Committee meetings documented", yesNo(i.committeeMinutes)],
        ["9 Officer not reachable at mailing address", yesNo(i.unreachableOfficer)],
      ]),
      fields("part-vi-b", "Part VI, Section B: Policies", [
        ["10a Local chapters or affiliates", yesNo(i.localChapters)],
        ["10b Written policies for chapters", i.localChapters ? yesNo(i.chapterPolicies) : "—"],
        ["11a Board receives the return before filing", yesNo(i.boardCopyBeforeFiling)],
        ["11b Review process (Schedule O)", i.formReviewProcess],
        ["12a Written conflict-of-interest policy", yesNo(i.conflictPolicy)],
        ["12b Annual disclosure required", i.conflictPolicy ? yesNo(i.annualDisclosure) : "—"],
        ["12c Policy monitored and enforced (Schedule O)", i.conflictPolicy ? i.conflictMonitoring : "—"],
        ["13 Whistleblower policy", yesNo(i.whistleblowerPolicy)],
        ["14 Document retention policy", yesNo(i.documentRetentionPolicy)],
        ["15a CEO compensation process", yesNo(i.compensationProcess)],
        ["15b Other officers' compensation process", yesNo(i.otherOfficerCompProcess)],
        ["16a Joint venture with a taxable entity", yesNo(i.jointVenture)],
        ["16b Joint venture policy", i.jointVenture ? yesNo(i.jointVenturePolicy) : "—"],
      ]),
      fields("part-vi-c", "Part VI, Section C: Disclosure", [
        ["17 States where the return is filed", i.statesFiled],
        ["18 How Forms 1023, 990, and 990-T are made available", { own_website: "Own website", upon_request: "Upon request", other_website: "Another's website", other: "Other" }[i.documentsAvailability]],
        ["19 Governing documents and financial statements (Schedule O)", "See Schedule O"],
        ["20 Books and records", [i.booksCustodianName, i.booksCustodianAddress, i.booksCustodianPhone].filter(Boolean).join(", ")],
      ]),
    ];
  },
});
