import { fields } from "@/core/render";
import { defineSchedule, yesNo } from "./common";

/** Schedule E: Schools. Racial nondiscrimination questions under Rev. Proc. 75-50 (now Rev. Proc. 2019-22). */

export interface ScheduleEIntake {
  eNondiscriminationInDocuments?: boolean;
  eNondiscriminationInMaterials?: boolean;
  ePolicyPublicized?: boolean;
  ePolicyPublicizedHow?: string;
  eRecordsRacialComposition?: boolean;
  eRecordsScholarships?: boolean;
  eRecordsMaterials?: boolean;
  eRecordsSolicitation?: boolean;
  eDiscriminationAny?: boolean;
  eDiscriminationExplanation?: string;
  eGovernmentAid?: boolean;
  eGovernmentAidRevoked?: boolean;
  eGovernmentAidExplanation?: string;
  eCertifies7550?: boolean;
}

export interface ScheduleEOut {
  answers: { line: string; question: string; answer: boolean | undefined }[];
  missing: string[];
}

const QUESTIONS: { line: string; key: keyof ScheduleEIntake; question: string }[] = [
  { line: "1", key: "eNondiscriminationInDocuments", question: "Racially nondiscriminatory policy stated in charter, bylaws, or other governing instrument, or in a board resolution" },
  { line: "2", key: "eNondiscriminationInMaterials", question: "Policy stated in brochures, catalogues, and other written communications with the public about programs, admissions, and scholarships" },
  { line: "3", key: "ePolicyPublicized", question: "Policy publicized to all segments of the general community during the period of solicitation or registration" },
  { line: "4a", key: "eRecordsRacialComposition", question: "Records maintained of the racial composition of students, faculty, and administrative staff" },
  { line: "4b", key: "eRecordsScholarships", question: "Records of scholarships and financial assistance awarded on a racially nondiscriminatory basis" },
  { line: "4c", key: "eRecordsMaterials", question: "Copies of all materials used to solicit contributions kept" },
  { line: "4d", key: "eRecordsSolicitation", question: "Copies of brochures, catalogues, and advertisements dealing with admissions, programs, and scholarships kept" },
  { line: "5", key: "eDiscriminationAny", question: "Discrimination by race in any way with respect to students' rights, admissions, employment, scholarships, educational policies, athletics, or other programs" },
  { line: "6a", key: "eGovernmentAid", question: "Receives financial aid or assistance from a governmental agency" },
  { line: "6b", key: "eGovernmentAidRevoked", question: "Right to such aid ever revoked or suspended" },
  { line: "7", key: "eCertifies7550", question: "Certifies compliance with the applicable requirements of Rev. Proc. 75-50 (as modified by Rev. Proc. 2019-22)" },
];

export const scheduleE = defineSchedule<ScheduleEOut>({
  schedule: "E",
  title: "Schools",
  intake: [
    {
      title: "Schedule E: schools",
      help: "For organizations that are schools under section 170(b)(1)(A)(ii). All answers concern the racially nondiscriminatory policy.",
      collapsible: true,
      fields: [
        ...QUESTIONS.map((q) => ({ name: q.key, type: "yesno" as const, label: `Line ${q.line}: ${q.question}?` })),
        { name: "ePolicyPublicizedHow", type: "textarea", label: "Line 3: how the policy was publicized (newspaper, broadcast media, or website in accordance with Rev. Proc. 2019-22)" },
        { name: "eDiscriminationExplanation", type: "textarea", label: "Line 5: if any discrimination, explain" },
        { name: "eGovernmentAidExplanation", type: "textarea", label: "Line 6: if government aid was received or revoked, explain" },
      ],
    },
  ],

  build(f) {
    const answers = QUESTIONS.map((q) => ({ line: q.line, question: q.question, answer: f.intake[q.key] as boolean | undefined }));
    return { answers, missing: answers.filter((a) => a.answer === undefined).map((a) => a.line) };
  },

  rules: [
    {
      id: "e.answered",
      severity: "error",
      ref: "Schedule E, Part I",
      description: "Every line is answered",
      check: ({ out }) => (out.missing.length ? `Answer Schedule E line${out.missing.length > 1 ? "s" : ""} ${out.missing.join(", ")}` : undefined),
    },
    {
      id: "e.explanations",
      severity: "error",
      ref: "Schedule E, Part II",
      description: "Lines 3, 5, 6, and a No on 1–4 or 7 are explained",
      check: ({ facts: { intake: i }, out }) =>
        [
          i.ePolicyPublicized && !i.ePolicyPublicizedHow && "Line 3: describe how the policy was publicized",
          i.eDiscriminationAny && !i.eDiscriminationExplanation && "Line 5: explain the discrimination reported",
          (i.eGovernmentAid || i.eGovernmentAidRevoked) && !i.eGovernmentAidExplanation && "Line 6: explain the government aid",
          out.answers.some((a) => ["1", "2", "3", "4a", "4b", "4c", "4d", "7"].includes(a.line) && a.answer === false) && "A No on lines 1–4 or 7 must be explained in Part II",
        ].filter((m): m is string => !!m),
    },
    {
      id: "e.compliance",
      severity: "warning",
      ref: "Schedule E, lines 5 and 7",
      description: "Racial nondiscrimination compliance",
      check: ({ facts: { intake: i } }) =>
        i.eDiscriminationAny || i.eCertifies7550 === false ? "The school reports discrimination or does not certify Rev. Proc. 75-50 compliance; this threatens exempt status, resolve with counsel before filing" : undefined,
    },
  ],

  render(out, f) {
    return [
      fields(
        "sched-e",
        "Schedule E: Schools",
        out.answers.map((a) => [`${a.line} ${a.question}`, yesNo(a.answer)] as [string, string]),
        [f.intake.ePolicyPublicizedHow && `Line 3: ${f.intake.ePolicyPublicizedHow}`, f.intake.eDiscriminationExplanation && `Line 5: ${f.intake.eDiscriminationExplanation}`, f.intake.eGovernmentAidExplanation && `Line 6: ${f.intake.eGovernmentAidExplanation}`].filter(Boolean).join(" ") || undefined,
      ),
    ];
  },
});
