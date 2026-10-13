import type { Cents } from "@/core/money";
import { fields, table } from "@/core/render";
import { POSITIONS } from "../intake";
import { amt, cents, defineSchedule, TIE, usd, yesNo } from "../schedules/common";

/**
 * Form 990 Part VII: Compensation of Officers, Directors, Trustees, Key Employees,
 * Highest Compensated Employees, and Independent Contractors.
 */

export interface PersonRow {
  name: string;
  title: string;
  position: string;
  former: boolean;
  hours: number;
  relatedHours: number;
  reportable: Cents;
  related: Cents;
  other: Cents;
}

export interface PartVIIOut {
  people: PersonRow[];
  line1b: { reportable: Cents; related: Cents; other: Cents };
  line2: number;
  line3: boolean;
  line4: boolean;
  line5: boolean;
  contractors: { name: string; address: string; service: string; amount: Cents }[];
  contractorsOver100k: number;
  ledgerOfficerComp: Cents;
}

const OVER_100K = 100_000_00;
const OVER_150K = 150_000_00;

export const partVII = defineSchedule<PartVIIOut>({
  schedule: "VII",
  title: "Compensation",
  intake: [],

  build(f) {
    const people = f.intake.officers.map((o) => ({
      name: o.name,
      title: o.title,
      position: o.position,
      former: !!o.former,
      hours: o.hours,
      relatedHours: o.relatedHours ?? 0,
      reportable: cents(o.compensation),
      related: cents(o.relatedCompensation),
      other: cents(o.otherCompensation),
    }));
    const sum = (k: "reportable" | "related" | "other") => people.reduce((t, p) => t + p[k], 0);
    const contractors = [...(f.intake.contractors ?? [])]
      .map((c) => ({ ...c, amount: cents(c.amount) }))
      .filter((c) => c.amount > OVER_100K)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    return {
      people,
      line1b: { reportable: sum("reportable"), related: sum("related"), other: sum("other") },
      line2: people.filter((p) => p.reportable + p.related > OVER_100K).length,
      line3: people.some((p) => p.former),
      line4: people.some((p) => p.reportable + p.related + p.other > OVER_150K),
      line5: !!f.intake.unrelatedCompensation,
      contractors,
      contractorsOver100k: Math.max(f.intake.contractorsOver100k ?? 0, contractors.length),
      ledgerOfficerComp: amt(f, "IX.5"),
    };
  },

  rules: [
    {
      id: "vii.officers_present",
      severity: "error",
      ref: "Part VII, Section A",
      description: "At least one officer and the full board are listed",
      check: ({ out, facts }) => {
        const msgs: string[] = [];
        if (!out.people.some((p) => p.position === "officer" && !p.former)) msgs.push("List at least one current officer (president, treasurer, or executive director)");
        const directors = out.people.filter((p) => (p.position === "director" || p.position === "institutional_trustee") && !p.former).length;
        if (directors < facts.intake.votingMembers)
          msgs.push(`Part VI reports ${facts.intake.votingMembers} voting members but only ${directors} directors or trustees are listed; list every person who served at any time during the year`);
        return msgs;
      },
    },
    {
      id: "vii.key_employee_threshold",
      severity: "warning",
      ref: "Part VII, Section A, column (C)",
      description: "Key employees and highest compensated employees meet the dollar tests",
      check: ({ out }) =>
        out.people.flatMap((p) => {
          const total = p.reportable + p.related;
          if (p.position === "key_employee" && total <= OVER_150K) return [`${p.name} is marked a key employee but reportable compensation is ${usd(total)}, not over $150,000`];
          if (p.position === "highest_compensated" && total <= OVER_100K) return [`${p.name} is marked a highest compensated employee but reportable compensation is ${usd(total)}, not over $100,000`];
          return [];
        }),
    },
    {
      id: "vii.officer_comp_ledger",
      severity: "warning",
      ref: "Part VII column (D) vs Part IX line 5",
      description: "Officer compensation agrees with the books",
      check: ({ out }) => {
        const officers = out.people.filter((p) => p.position === "officer" || p.position === "key_employee" || p.position === "director" || p.position === "institutional_trustee");
        const listed = officers.reduce((t, p) => t + p.reportable, 0);
        return out.ledgerOfficerComp > 0 && Math.abs(listed - out.ledgerOfficerComp) > Math.max(TIE, 1_000_00)
          ? `Officers, directors, and key employees list ${usd(listed)} of compensation; Part IX line 5 shows ${usd(out.ledgerOfficerComp)}`
          : undefined;
      },
    },
    {
      id: "vii.contractors",
      severity: "warning",
      ref: "Part VII, Section B",
      description: "Large contractor payments are listed",
      check: ({ out, facts }) =>
        !out.contractors.length && amt(facts, "IX.11a", "IX.11b", "IX.11c", "IX.11e", "IX.11g") > OVER_100K
          ? "Professional fees exceed $100,000 in total; confirm whether any single contractor was paid more than $100,000 (Section B)"
          : undefined,
    },
    {
      id: "vii.schedule_j",
      severity: "info",
      ref: "Part VII, lines 3–5",
      description: "Yes on lines 3, 4, or 5 requires Schedule J",
      check: ({ out }) => (out.line3 || out.line4 || out.line5 ? "Schedule J is required for the people listed; its detail is in the Schedule J section" : undefined),
    },
  ],

  render(out, f) {
    const pos = (p: PersonRow) => `${POSITIONS.find((x) => x.value === p.position)?.label.split(" (")[0] ?? p.position}${p.former ? ", former" : ""}`;
    return [
      table(
        "part-vii-a",
        "Part VII, Section A: officers, directors, trustees, key employees, highest compensated employees",
        [["name", "(A) Name and title"], ["hours", "(B) Hours/week (related)", true], ["position", "(C) Position"], ["reportable", "(D) From the organization", true], ["related", "(E) From related organizations", true], ["other", "(F) Other compensation", true]],
        out.people.map((p) => ({
          name: `${p.name}, ${p.title}`,
          hours: p.relatedHours ? `${p.hours} (${p.relatedHours})` : p.hours,
          position: pos(p),
          reportable: usd(p.reportable),
          related: usd(p.related),
          other: usd(p.other),
        })),
        { footer: { name: "1b Subtotal / 1d Total", hours: "", position: "", reportable: usd(out.line1b.reportable), related: usd(out.line1b.related), other: usd(out.line1b.other) } },
      ),
      fields("part-vii-q", "Part VII, Section A, lines 2–5", [
        ["2 Individuals over $100,000 of reportable compensation", out.line2],
        ["3 Former officer, director, trustee, or key employee listed", yesNo(out.line3)],
        ["4 Any individual over $150,000 of total compensation", yesNo(out.line4)],
        ["5 Compensation from an unrelated organization for services to this one", yesNo(out.line5)],
        ["Volunteers (Part I line 6)", f.intake.volunteers],
      ]),
      table(
        "part-vii-b",
        "Part VII, Section B: independent contractors over $100,000",
        [["name", "(A) Name and business address"], ["service", "(B) Description of services"], ["amount", "(C) Compensation", true]],
        out.contractors.map((c) => ({ name: `${c.name}, ${c.address}`, service: c.service, amount: usd(c.amount) })),
        { note: `Line 2: ${out.contractorsOver100k} independent contractor(s) received more than $100,000.` },
      ),
    ];
  },
});
