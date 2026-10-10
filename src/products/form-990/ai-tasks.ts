import { z } from "zod";
import type { AiTask } from "@/core/ai/llm";

const FACTS_ONLY =
  "Use only facts supplied in the input. Never invent numbers, outcomes, or names. " +
  "Write in plain, factual third person, as filed with the IRS and published on public databases.";

type ProgramInput = {
  mission: string;
  programs: { name: string; description: string; beneficiaries?: string; expenses: number }[];
};

const programsOutput = z.object({
  programs: z.array(z.object({ name: z.string(), description: z.string().max(1200) })),
});

export const draftProgramDescriptions: AiTask<ProgramInput, z.infer<typeof programsOutput>> = {
  id: "form990.program_descriptions",
  version: 1,
  system:
    "You draft Form 990 Part III program service accomplishment descriptions for a nonprofit. " +
    "For each program write 2–4 sentences: what the program does, who it serves, and measurable results if given. " +
    FACTS_ONLY,
  prompt: ({ mission, programs }) =>
    `Mission: ${mission}\n\nPrograms:\n${programs
      .map(
        (p, i) =>
          `${i + 1}. ${p.name} (expenses $${p.expenses.toLocaleString("en-US")})\n   Client notes: ${p.description}${
            p.beneficiaries ? `\n   Served: ${p.beneficiaries}` : ""
          }`,
      )
      .join("\n")}`,
  schema: programsOutput,
  fallback: ({ programs }) => ({
    programs: programs.map((p) => ({
      name: p.name,
      description: [p.description.trim(), p.beneficiaries ? `Served ${p.beneficiaries.trim()}.` : ""]
        .filter(Boolean)
        .join(" "),
    })),
  }),
};

type ScheduleOInput = {
  formReviewProcess: string;
  conflictPolicy: boolean;
  conflictMonitoring?: string;
  documentsAvailability: string;
  website?: string;
};

const scheduleOOutput = z.object({
  entries: z.array(z.object({ ref: z.string(), text: z.string().max(1500) })),
});

const AVAILABILITY: Record<string, string> = {
  own_website: "on the organization's website",
  upon_request: "upon request",
  other_website: "on another organization's website",
  other: "by other means",
};

export const draftScheduleO: AiTask<ScheduleOInput, z.infer<typeof scheduleOOutput>> = {
  id: "form990.schedule_o",
  version: 1,
  system:
    "You draft Form 990 Schedule O narrative responses for Part VI governance questions. " +
    "Return one entry per reference provided: 'Part VI, line 11b' (board review of the return), " +
    "'Part VI, line 12c' (conflict-of-interest monitoring, only if a policy exists), and 'Part VI, line 19' " +
    "(public availability of documents). Each entry is 1–3 sentences. " +
    FACTS_ONLY,
  prompt: (i) =>
    [
      `Board review process (client words): ${i.formReviewProcess}`,
      `Conflict-of-interest policy: ${i.conflictPolicy ? "yes" : "no"}`,
      i.conflictPolicy ? `Monitoring (client words): ${i.conflictMonitoring || "not described"}` : "",
      `Documents available ${AVAILABILITY[i.documentsAvailability] ?? "upon request"}${i.website ? ` (${i.website})` : ""}`,
    ]
      .filter(Boolean)
      .join("\n"),
  schema: scheduleOOutput,
  fallback: (i) => ({
    entries: [
      { ref: "Part VI, line 11b", text: i.formReviewProcess.trim() },
      ...(i.conflictPolicy
        ? [
            {
              ref: "Part VI, line 12c",
              text:
                i.conflictMonitoring?.trim() ||
                "Officers and directors disclose conflicts annually; interested persons are excluded from related votes.",
            },
          ]
        : []),
      {
        ref: "Part VI, line 19",
        text: `The organization makes its governing documents, conflict-of-interest policy, and financial statements available to the public ${
          AVAILABILITY[i.documentsAvailability] ?? "upon request"
        }.`,
      },
    ],
  }),
};
