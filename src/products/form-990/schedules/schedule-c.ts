import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import { amt, cents, defineSchedule, usd } from "./common";

/**
 * Schedule C: Political Campaign and Lobbying Activities.
 * Part I-A/I-B: political campaign activity (prohibited for 501(c)(3)s; section 4955 tax).
 * Part II-A: 501(c)(3)s that elected under section 501(h) (expenditure test).
 * Part II-B: 501(c)(3)s that did not elect (substantial-part test).
 */

export const LOBBYING_METHODS = [
  { value: "1a", label: "Volunteers" },
  { value: "1b", label: "Paid staff or management" },
  { value: "1c", label: "Media advertisements" },
  { value: "1d", label: "Mailings to members, legislators, or the public" },
  { value: "1e", label: "Publications or published or broadcast statements" },
  { value: "1f", label: "Grants to other organizations for lobbying" },
  { value: "1g", label: "Direct contact with legislators, their staffs, government officials, or a legislative body" },
  { value: "1h", label: "Rallies, demonstrations, seminars, conventions, speeches, lectures" },
  { value: "1i", label: "Other activities" },
] as const;

export interface ScheduleCIntake {
  politicalDescription?: string;
  politicalExpenditures?: number;
  politicalVolunteerHours?: number;
  elected501h?: boolean;
  directLobbying?: number;
  grassrootsLobbying?: number;
  lobbyingActivities?: { method: (typeof LOBBYING_METHODS)[number]["value"]; amount?: number }[];
  lobbyingDescription?: string;
}

export interface ScheduleCOut {
  political: boolean;
  politicalExpenditures: Cents;
  election: "501h" | "substantial_part" | "not_501c3";
  partIIA?: {
    grassroots: Cents; direct: Cents; totalLobbying: Cents; otherExempt: Cents; exemptPurpose: Cents;
    nontaxable: Cents; grassrootsNontaxable: Cents; grassrootsExcess: Cents; lobbyingExcess: Cents;
  };
  partIIB?: { activities: { line: string; label: string; amount: Cents }[]; total: Cents };
  ledgerLobbying: Cents;
}

/** Lobbying nontaxable amount under section 4911(c)(2), capped at $1,000,000. */
export function lobbyingNontaxable(exemptPurpose: Cents): Cents {
  const e = exemptPurpose;
  const tiers: [limit: Cents, base: Cents, rate: number, from: Cents][] = [
    [500_000_00, 0, 0.2, 0],
    [1_000_000_00, 100_000_00, 0.15, 500_000_00],
    [1_500_000_00, 175_000_00, 0.1, 1_000_000_00],
    [17_000_000_00, 225_000_00, 0.05, 1_500_000_00],
  ];
  for (const [limit, base, rate, from] of tiers) if (e <= limit) return Math.round(base + (e - from) * rate);
  return 1_000_000_00;
}

export const scheduleC = defineSchedule<ScheduleCOut>({
  schedule: "C",
  title: "Political Campaign and Lobbying Activities",
  intake: [
    {
      title: "Schedule C: lobbying and political activity",
      help: "Complete only if you answered yes to lobbying or political campaign activity.",
      collapsible: true,
      fields: [
        { name: "politicalDescription", type: "textarea", label: "Describe any political campaign activity (for or against a candidate)" },
        { name: "politicalExpenditures", type: "money", label: "Political campaign expenditures ($)" },
        { name: "politicalVolunteerHours", type: "number", label: "Volunteer hours for political campaign activities", min: 0 },
        { name: "elected501h", type: "yesno", label: "501(c)(3) only: has the organization filed Form 5768 to elect the lobbying expenditure test (section 501(h))?" },
        { name: "directLobbying", type: "money", label: "If elected: direct lobbying expenditures ($)" },
        { name: "grassrootsLobbying", type: "money", label: "If elected: grassroots lobbying expenditures ($)" },
        {
          name: "lobbyingActivities",
          type: "list",
          label: "If not elected: how the organization lobbied, and what it spent on each method",
          rows: 4,
          fields: [
            { name: "method", type: "select", label: "Method", required: true, options: LOBBYING_METHODS },
            { name: "amount", type: "money", label: "Amount spent ($)" },
          ],
        },
        { name: "lobbyingDescription", type: "textarea", label: "If not elected: describe the lobbying activities (reported in Part IV)" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const ledgerLobbying = amt(f, "IX.11d");
    const out: ScheduleCOut = {
      political: !!i.politicalCampaign || cents(i.politicalExpenditures) > 0,
      politicalExpenditures: cents(i.politicalExpenditures),
      election: i.subsection !== "501c3" ? "not_501c3" : i.elected501h ? "501h" : "substantial_part",
      ledgerLobbying,
    };
    if (out.election === "501h") {
      const grassroots = cents(i.grassrootsLobbying);
      const direct = cents(i.directLobbying);
      const totalLobbying = grassroots + direct;
      // Exempt purpose expenditures: total functional expenses less investment management fees.
      const exemptPurpose = f.totalExpenses - amt(f, "IX.11f");
      const nontaxable = lobbyingNontaxable(exemptPurpose);
      const grassrootsNontaxable = Math.round(nontaxable * 0.25);
      out.partIIA = {
        grassroots, direct, totalLobbying,
        otherExempt: exemptPurpose - totalLobbying,
        exemptPurpose, nontaxable, grassrootsNontaxable,
        grassrootsExcess: Math.max(0, grassroots - grassrootsNontaxable),
        lobbyingExcess: Math.max(0, totalLobbying - nontaxable),
      };
    }
    if (out.election === "substantial_part") {
      const activities = (i.lobbyingActivities ?? []).map((a) => ({
        line: a.method,
        label: LOBBYING_METHODS.find((m) => m.value === a.method)?.label ?? a.method,
        amount: cents(a.amount),
      }));
      out.partIIB = { activities, total: activities.reduce((t, a) => t + a.amount, 0) };
    }
    return out;
  },

  rules: [
    {
      id: "c.political_501c3",
      severity: "error",
      ref: "Schedule C, Part I-B",
      description: "501(c)(3) organizations may not intervene in political campaigns",
      check: ({ out, facts }) =>
        facts.intake.subsection === "501c3" && out.political
          ? "A 501(c)(3) reported political campaign activity. This can cost the exemption and triggers the section 4955 excise tax (Form 4720). Resolve with the client before filing."
          : undefined,
    },
    {
      id: "c.political_described",
      severity: "error",
      ref: "Schedule C, Part I-A line 1",
      description: "Political campaign activity is described",
      check: ({ out, facts }) => (out.political && !facts.intake.politicalDescription ? "Describe the political campaign activity" : undefined),
    },
    {
      id: "c.election_answered",
      severity: "error",
      ref: "Schedule C, Part II",
      description: "The 501(h) election is answered",
      check: ({ out, facts }) =>
        out.election !== "not_501c3" && facts.intake.lobbying && facts.intake.elected501h === undefined
          ? "Answer whether the organization elected the 501(h) expenditure test"
          : undefined,
    },
    {
      id: "c.excess_lobbying",
      severity: "error",
      ref: "Schedule C, Part II-A lines 1h–1i",
      description: "Lobbying stays within the nontaxable amounts",
      check: ({ out }) => {
        const p = out.partIIA;
        if (!p) return;
        const msgs: string[] = [];
        if (p.lobbyingExcess > 0) msgs.push(`Lobbying exceeds the nontaxable amount by ${usd(p.lobbyingExcess)}`);
        if (p.grassrootsExcess > 0) msgs.push(`Grassroots lobbying exceeds its nontaxable amount by ${usd(p.grassrootsExcess)}`);
        return msgs.map((m) => `${m}; the section 4911 tax applies (Form 4720) and the four-year averages in Part II-A must be completed`);
      },
    },
    {
      id: "c.four_year_average",
      severity: "info",
      ref: "Schedule C, Part II-A, columns (a)–(e)",
      description: "Electing organizations report four-year averages",
      check: ({ out }) =>
        out.partIIA ? "Complete the four-year averaging period in Part II-A from prior returns; this worksheet shows the current year" : undefined,
    },
    {
      id: "c.activities_listed",
      severity: "error",
      ref: "Schedule C, Part II-B",
      description: "Non-electing organizations describe how they lobbied",
      check: ({ out, facts }) =>
        out.partIIB && facts.intake.lobbying && (!out.partIIB.activities.length || !facts.intake.lobbyingDescription)
          ? "List the lobbying methods with amounts and describe the activities (Part II-B and Part IV)"
          : undefined,
    },
    {
      id: "c.ledger_ties",
      severity: "warning",
      ref: "Part IX, line 11d",
      description: "Lobbying fees in the books are reflected in Schedule C",
      check: ({ out }) => {
        const reported = out.partIIA?.totalLobbying ?? out.partIIB?.total ?? 0;
        return out.ledgerLobbying > reported
          ? `The books show ${usd(out.ledgerLobbying)} of lobbying fees, more than the ${usd(reported)} reported on Schedule C`
          : undefined;
      },
    },
    {
      id: "c.not_501c3",
      severity: "info",
      ref: "Schedule C, Part III",
      description: "Section 501(c)(4), (5), and (6) organizations complete Part III",
      check: ({ out }) =>
        out.election === "not_501c3"
          ? "This organization is not a 501(c)(3); complete Part III (lobbying and proxy tax notice) by hand"
          : undefined,
    },
  ],

  render(out, f) {
    const s: ReviewSection[] = [
      fields("sched-c-1", "Schedule C Part I: political campaign activities", [
        ["Political campaign activity", out.political],
        ["Description (Part I-A line 1)", f.intake.politicalDescription],
        ["Expenditures (Part I-A line 2)", usd(out.politicalExpenditures)],
        ["Volunteer hours (Part I-A line 3)", f.intake.politicalVolunteerHours],
      ]),
    ];
    if (out.partIIA) {
      const p = out.partIIA;
      s.push(
        fields("sched-c-2a", "Schedule C Part II-A: 501(h) expenditure test (current year)", [
          ["1a Grassroots lobbying", usd(p.grassroots)],
          ["1b Direct lobbying", usd(p.direct)],
          ["1c Total lobbying", usd(p.totalLobbying)],
          ["1d Other exempt purpose expenditures", usd(p.otherExempt)],
          ["1e Total exempt purpose expenditures", usd(p.exemptPurpose)],
          ["1f Lobbying nontaxable amount", usd(p.nontaxable)],
          ["1g Grassroots nontaxable amount (25% of 1f)", usd(p.grassrootsNontaxable)],
          ["1h Grassroots over nontaxable", usd(p.grassrootsExcess)],
          ["1i Total lobbying over nontaxable", usd(p.lobbyingExcess)],
        ], "Exempt purpose expenditures are total functional expenses less investment management fees. Remove capital expenditures and costs of a separate fundraising unit if any."),
      );
    }
    if (out.partIIB)
      s.push(
        table(
          "sched-c-2b",
          "Schedule C Part II-B: lobbying activities (no 501(h) election)",
          [["line", "Line"], ["label", "Activity"], ["amount", "Amount", true]],
          out.partIIB.activities.map((a) => ({ line: a.line, label: a.label, amount: usd(a.amount) })),
          { footer: { line: "1j", label: "Total", amount: usd(out.partIIB.total) }, note: f.intake.lobbyingDescription },
        ),
      );
    return s;
  },
});
