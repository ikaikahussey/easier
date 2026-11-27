import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  addYears,
  audit,
  clearance,
  collectionProblem,
  deadlines,
  dutyBeforeResult,
  misCounts,
  misStatus,
  obligations,
  openItems,
  planDraw,
  pool,
  randomStatus,
  records,
  todayIn,
  zonedToUtc,
} from "@/programs/part-120/rules";
import type { Incident, Person, Program, State, Test, WithId } from "@/programs/part-120/types";

const program: Program = { orgId: "org", operation: "part135", registrationKind: "a449", registrationRef: "A449-123", derUserId: "der", timeZone: "Pacific/Honolulu", misNotified: false };

let seq = 0;
const person = (over: Partial<WithId<Person>> = {}): WithId<Person> => ({
  id: `p${++seq}`,
  name: `Person ${seq}`,
  title: "Mechanic",
  functions: ["maintenance"],
  supervisor: false,
  medical: false,
  airman: false,
  priorEmployers: [],
  training: [],
  ...over,
});
const test = (over: Partial<WithId<Test>> & { personId: string }): WithId<Test> => ({ id: `t${++seq}`, reason: "pre_employment", substance: "drug", orderedOn: "2026-01-02", ...over });
const negative = (personId: string, verifiedOn = "2026-01-05") => test({ personId, result: "negative", verifiedOn, collectedAt: `${verifiedOn}T20:00:00.000Z` });

/** A fully documented, working employee. */
function cleared(over: Partial<WithId<Person>> = {}): { p: WithId<Person>; t: WithId<Test> } {
  const p = person({ consentOn: "2026-01-02", askedOn: "2026-01-02", noPriorDot: true, firstDutyOn: "2026-01-06", training: [{ kind: "employee", on: "2026-01-06", minutes: 60 }], ...over });
  return { p, t: negative(p.id) };
}

const state = (over: Partial<State> = {}): State => ({ program, people: [], tests: [], draws: [], incidents: [], contractors: [], filings: [], ...over });

function staffed(n: number): State {
  const made = Array.from({ length: n }, () => cleared());
  return state({ people: made.map((m) => m.p), tests: made.map((m) => m.t) });
}

describe("dates", () => {
  it("counts working days across a weekend", () => {
    expect(addWorkingDays("2026-11-27", 2)).toBe("2026-12-01"); // Friday → Tuesday
    expect(addWorkingDays("2026-11-23", 2)).toBe("2026-11-25"); // Monday → Wednesday
  });
  it("adds years, clamping February 29", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2026-11-26", 5)).toBe("2031-11-26");
  });
  it("converts wall-clock time in the employer's zone", () => {
    expect(zonedToUtc("2026-11-26T08:00", "Pacific/Honolulu")?.toISOString()).toBe("2026-11-26T18:00:00.000Z");
    expect(zonedToUtc("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedToUtc("2026-12-01T12:00", "America/New_York")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(zonedToUtc("yesterday", "UTC")).toBeUndefined();
  });
  it("reads today's date in the employer's zone", () => {
    expect(todayIn("Pacific/Honolulu", new Date("2026-11-27T05:00:00Z"))).toBe("2026-11-26");
    expect(todayIn("UTC", new Date("2026-11-27T05:00:00Z"))).toBe("2026-11-27");
  });
});

describe("clearance gate", () => {
  it("blocks a new hire with nothing on file and names each gap", () => {
    const p = person();
    const r = clearance(p, [], "2026-02-01");
    expect(r.cleared).toBe(false);
    expect(r.blockers).toEqual([
      "Pre-employment drug test not ordered",
      "Written consent to the prior-employer records request not on file",
      "Not yet asked about a positive or refused pre-employment test in the past two years",
      "Prior-employer testing records not requested",
    ]);
  });

  it("stays blocked while the result is pending and until the verified date", () => {
    const p = person({ consentOn: "2026-01-02", askedOn: "2026-01-02", noPriorDot: true });
    expect(clearance(p, [test({ personId: p.id })], "2026-02-01").blockers).toEqual(["Pre-employment drug test ordered; verified negative result not yet received"]);
    const t = negative(p.id, "2026-01-05");
    expect(clearance(p, [t], "2026-01-04").cleared).toBe(false);
    expect(clearance(p, [t], "2026-01-05").cleared).toBe(true);
  });

  it("does not accept a positive, cancelled, or alcohol test as the pre-employment result", () => {
    const p = person({ consentOn: "2026-01-02", askedOn: "2026-01-02", noPriorDot: true });
    for (const t of [
      test({ personId: p.id, result: "cancelled", verifiedOn: "2026-01-05" }),
      test({ personId: p.id, substance: "alcohol", result: "negative", verifiedOn: "2026-01-05" }),
      test({ personId: p.id, reason: "random", result: "negative", verifiedOn: "2026-01-05" }),
    ])
      expect(clearance(p, [t], "2026-02-01").cleared).toBe(false);
  });

  it("blocks on refused consent and on an admitted prior violation without return-to-duty", () => {
    const base = { askedOn: "2026-01-02", noPriorDot: true } as const;
    const refused = person({ ...base, consentRefused: true });
    expect(clearance(refused, [negative(refused.id)], "2026-02-01").blockers).toEqual(["Refused written consent to the prior-employer records request"]);
    const admitted = person({ ...base, consentOn: "2026-01-02", admitted: true });
    expect(clearance(admitted, [negative(admitted.id)], "2026-02-01").cleared).toBe(false);
    admitted.returnToDutyOn = "2026-01-20";
    expect(clearance(admitted, [negative(admitted.id)], "2026-02-01").cleared).toBe(true);
  });

  it("applies the 30-day prior-employer limit from first duty", () => {
    const p = person({ consentOn: "2026-01-02", askedOn: "2026-01-02", priorEmployers: [{ name: "Old Air", requestedOn: "2026-01-02" }], firstDutyOn: "2026-01-06" });
    const t = negative(p.id);
    const day30 = clearance(p, [t], "2026-02-05");
    expect(day30.cleared).toBe(true);
    expect(day30.warnings[0]).toMatch(/0 days left/);
    expect(clearance(p, [t], "2026-02-06").blockers).toEqual(["30 days have passed since first duty without prior-employer records or a documented good-faith effort"]);
    expect(clearance({ ...p, goodFaithOn: "2026-02-01" }, [t], "2026-03-01").cleared).toBe(true);
    expect(clearance({ ...p, priorEmployers: [{ name: "Old Air", requestedOn: "2026-01-02", receivedOn: "2026-01-20" }] }, [t], "2026-03-01").cleared).toBe(true);
  });

  it("requires the request to be sent to every listed prior employer", () => {
    const p = person({ consentOn: "2026-01-02", askedOn: "2026-01-02", priorEmployers: [{ name: "Old Air", requestedOn: "2026-01-02" }, { name: "Older Air" }] });
    expect(clearance(p, [negative(p.id)], "2026-02-01").blockers).toEqual(["Prior-employer testing records not requested"]);
  });

  it("removes a person from duty after a positive or refusal until return-to-duty", () => {
    const { p, t } = cleared();
    const positive = test({ personId: p.id, reason: "random", result: "positive", verifiedOn: "2026-06-10" });
    expect(clearance(p, [t, positive], "2026-06-11").cleared).toBe(false);
    expect(clearance({ ...p, returnToDutyOn: "2026-06-01" }, [t, positive], "2026-06-11").cleared).toBe(false); // predates the violation
    expect(clearance({ ...p, returnToDutyOn: "2026-08-01" }, [t, positive], "2026-08-02").cleared).toBe(true);
  });

  it("flags first duty before the verified result", () => {
    const p = person({ firstDutyOn: "2026-01-03" });
    expect(dutyBeforeResult(p, [negative(p.id, "2026-01-05")])).toBe(true);
    expect(dutyBeforeResult({ ...p, firstDutyOn: "2026-01-05" }, [negative(p.id, "2026-01-05")])).toBe(false);
    expect(dutyBeforeResult(person(), [])).toBe(false);
  });
});

describe("random testing", () => {
  it("includes only people currently on duty in the pool", () => {
    const s = staffed(3);
    s.people[0]!.separatedOn = "2026-03-01";
    s.people.push(person()); // never assigned
    expect(pool(s, "2026-06-01").map((p) => p.id)).toEqual([s.people[1]!.id, s.people[2]!.id]);
  });

  it("spreads the annual minimum across four quarters", () => {
    const s = staffed(10); // 25% → 3 drug, 10% → 1 alcohol
    const picks: Record<number, number> = {};
    for (let q = 1; q <= 4; q++) {
      const plan = planDraw(s, 2026, q, "2026-06-01", () => 0);
      picks[q] = plan.selections.filter((x) => x.substance === "drug").length;
      s.draws.push({ id: `d${q}`, year: 2026, period: q, drawnAt: "2026-06-01T00:00:00Z", poolIds: plan.poolIds, method: "test", selections: plan.selections.map((x, i) => ({ ...x, testId: `d${q}-${i}` })) });
    }
    expect(picks).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0 });
    const all = s.draws.flatMap((d) => d.selections);
    expect(all.filter((x) => x.substance === "drug")).toHaveLength(3);
    expect(all.filter((x) => x.substance === "alcohol")).toHaveLength(1);
  });

  it("never selects the same person twice for one substance in a draw, and never more than the pool", () => {
    const s = staffed(2);
    const plan = planDraw(s, 2026, 4, "2026-06-01", () => 0);
    const drug = plan.selections.filter((x) => x.substance === "drug").map((x) => x.personId);
    expect(new Set(drug).size).toBe(drug.length);
    expect(drug.length).toBeLessThanOrEqual(2);
  });

  it("replaces a cancelled selection in a later draw", () => {
    const s = staffed(4); // 1 drug per year
    s.draws.push({ id: "d1", year: 2026, period: 1, drawnAt: "2026-02-01T00:00:00Z", poolIds: s.people.map((p) => p.id), method: "test", selections: [{ personId: s.people[0]!.id, substance: "drug", testId: "x" }] });
    s.tests.push(test({ id: "x", personId: s.people[0]!.id, reason: "random", result: "cancelled", verifiedOn: "2026-02-03", collectedAt: "2026-02-02T20:00:00Z" }));
    expect(planDraw(s, 2026, 2, "2026-05-01", () => 0).selections.filter((x) => x.substance === "drug")).toHaveLength(1);
  });

  it("reports progress against the minimum using the average pool", () => {
    const s = staffed(10);
    s.draws.push({ id: "d1", year: 2026, period: 1, drawnAt: "2026-02-01T00:00:00Z", poolIds: Array(8).fill("x"), method: "test", selections: [] });
    s.draws.push({ id: "d2", year: 2026, period: 2, drawnAt: "2026-05-01T00:00:00Z", poolIds: Array(12).fill("x"), method: "test", selections: [] });
    s.tests.push(test({ personId: s.people[0]!.id, reason: "random", collectedAt: "2026-02-03T20:00:00Z", result: "negative", verifiedOn: "2026-02-05" }));
    s.tests.push(test({ personId: s.people[1]!.id, reason: "random", orderedOn: "2026-05-01" })); // outstanding
    s.tests.push(test({ personId: s.people[2]!.id, reason: "random", collectedAt: "2025-12-30T20:00:00Z", result: "negative", verifiedOn: "2025-12-31" })); // last year
    const r = randomStatus(s, 2026, "2026-06-01");
    expect(r.averagePool).toBe(10);
    expect(r.required).toEqual({ drug: 3, alcohol: 1 });
    expect(r.completed).toEqual({ drug: 1, alcohol: 0 });
    expect(r.outstanding).toHaveLength(1);
    expect(r.ratesConfirmed).toBe(true);
    expect(randomStatus(s, 2031, "2031-06-01").ratesConfirmed).toBe(false);
  });
});

describe("event clocks", () => {
  const accident: Incident = { kind: "post_accident", personId: "p", occurredAt: "2026-06-01T10:00:00.000Z", note: "x", testingRequired: true };

  it("sets 2-hour, 8-hour, and 32-hour limits after an accident", () => {
    expect(deadlines(accident)).toEqual({ alcoholRecordAt: "2026-06-01T12:00:00.000Z", alcoholCeaseAt: "2026-06-01T18:00:00.000Z", drugCeaseAt: "2026-06-02T18:00:00.000Z" });
    expect(deadlines({ ...accident, kind: "reasonable_cause" }).drugCeaseAt).toBeUndefined();
  });

  it("accepts timely collections and refuses late ones", () => {
    expect(collectionProblem(accident, "alcohol", "2026-06-01T11:59:00.000Z")).toBeUndefined();
    expect(collectionProblem(accident, "alcohol", "2026-06-01T13:00:00.000Z")).toMatch(/more than 2 hours/);
    expect(collectionProblem(accident, "alcohol", "2026-06-01T13:00:00.000Z", "Collector was two hours away")).toBeUndefined();
    expect(collectionProblem(accident, "alcohol", "2026-06-01T18:00:01.000Z", "late")).toMatch(/must stop 8 hours/);
    expect(collectionProblem(accident, "drug", "2026-06-02T18:00:00.000Z")).toBeUndefined();
    expect(collectionProblem(accident, "drug", "2026-06-02T18:00:01.000Z")).toMatch(/within 32 hours/);
    expect(collectionProblem(accident, "drug", "2026-06-01T09:00:00.000Z")).toMatch(/before the event/);
    expect(collectionProblem({ ...accident, kind: "reasonable_cause" }, "drug", "2026-06-05T00:00:00.000Z")).toBeUndefined();
  });
});

describe("reports to the FAA", () => {
  it("creates the right obligations for medical and airman certificate holders", () => {
    const pilot = person({ medical: true, airman: true, functions: ["flight_crew"] });
    const mechanic = person({ airman: true });
    const dispatcher = person();
    const s = state({
      people: [pilot, mechanic, dispatcher],
      tests: [
        test({ id: "a", personId: pilot.id, reason: "random", result: "positive", verifiedOn: "2026-11-27" }),
        test({ id: "b", personId: pilot.id, reason: "random", result: "refusal", verifiedOn: "2026-11-23" }),
        test({ id: "c", personId: mechanic.id, reason: "random", result: "refusal", verifiedOn: "2026-11-23", reportedFaaOn: "2026-11-24" }),
        test({ id: "d", personId: mechanic.id, reason: "random", result: "positive", verifiedOn: "2026-11-23" }),
        test({ id: "e", personId: dispatcher.id, reason: "random", result: "positive", verifiedOn: "2026-11-23" }),
        test({ id: "f", personId: pilot.id, reason: "random", result: "negative", verifiedOn: "2026-11-23" }),
      ],
    });
    expect(obligations(s).map((o) => [o.testId, o.to, o.dueOn, !!o.doneOn])).toEqual([
      ["a", "fas", "2026-12-01", false],
      ["b", "fas", "2026-11-25", false],
      ["b", "faa", "2026-11-25", false],
      ["c", "faa", "2026-11-25", true],
    ]);
  });
});

describe("retention", () => {
  it("assigns each record its minimum period", () => {
    const pilot = person({ name: "Pat Pilot", functions: ["flight_crew"], consentOn: "2026-01-02", firstDutyOn: "2026-01-06", training: [{ kind: "employee", on: "2026-01-06", minutes: 60 }] });
    const mech = person({ name: "Max Mech" });
    const s = state({
      people: [pilot, mech],
      tests: [
        negative(pilot.id, "2026-01-05"),
        negative(mech.id, "2026-01-05"),
        test({ personId: mech.id, reason: "random", result: "positive", verifiedOn: "2026-03-10", reportedFasOn: "2026-03-11" }),
        test({ personId: mech.id, reason: "random", substance: "alcohol", result: "low", verifiedOn: "2026-03-10" }),
        test({ personId: mech.id, reason: "post_accident", substance: "alcohol", orderedOn: "2026-04-01", notAdministeredReason: "No technician within 8 hours" }),
        test({ personId: mech.id, reason: "random" }), // open: no record yet
      ],
      filings: [{ id: "f", year: 2025, filedOn: "2026-03-01", certifiedBy: "D. Rep", counts: [] }],
    });
    const by = Object.fromEntries(records(s).map((r) => [r.title, r.keepUntil]));
    expect(by["Pre-employment drug test: Pat Pilot"]).toBe("2031-01-05"); // pilot record
    expect(by["Pre-employment drug test: Max Mech"]).toBe("2027-01-05"); // 1 year
    expect(by["Random drug test: Max Mech"]).toBe("2031-03-10"); // 5 years
    expect(by["Random alcohol test: Max Mech"]).toBe("2031-03-10"); // 0.02 or greater
    expect(by["Post-accident alcohol test: Max Mech (not administered)"]).toBe("2028-04-01"); // 2 years
    expect(by["Report to the Federal Air Surgeon: Max Mech"]).toBe("2031-03-11");
    expect(by["Consent and prior-employer request: Pat Pilot"]).toBe("2029-01-06"); // 3 years from first duty
    expect(by["Employee training: Pat Pilot"]).toBe("2028-01-06");
    expect(by["Annual report for 2025"]).toBe("2031-03-01");
    expect(by["OpSpec A449: A449-123"]).toBeUndefined();
    expect(records(s)).toHaveLength(10);
  });
});

describe("annual report", () => {
  it("is required for Part 121, at 50 covered employees, or on FAA notice", () => {
    const small = staffed(3);
    expect(misStatus(small, 2026)).toMatchObject({ required: false, coveredOnJan1: 0, dueOn: "2027-03-15" });
    expect(misStatus(small, 2027)).toMatchObject({ required: false, coveredOnJan1: 3 });
    expect(misStatus({ ...small, program: { ...program, misNotified: true } }, 2027).required).toBe(true);
    expect(misStatus({ ...small, program: { ...program, operation: "part121" } }, 2027).required).toBe(true);
    expect(misStatus(staffed(49), 2027).required).toBe(false);
    expect(misStatus(staffed(50), 2027).required).toBe(true);
  });

  it("counts tests by category for the year", () => {
    const s = staffed(2);
    s.tests.push(test({ personId: s.people[0]!.id, reason: "random", collectedAt: "2026-05-02T20:00:00Z", result: "positive", verifiedOn: "2026-05-04" }));
    s.tests.push(test({ personId: s.people[1]!.id, reason: "random", result: "refusal", verifiedOn: "2026-05-04" }));
    s.tests.push(test({ personId: s.people[1]!.id, reason: "random", orderedOn: "2026-05-01" })); // never collected
    const rows = misCounts(s, 2026);
    expect(rows.find((r) => r.reason === "pre_employment")).toMatchObject({ tests: 2, positive: 0 });
    expect(rows.find((r) => r.reason === "random" && r.substance === "drug")).toMatchObject({ tests: 2, positive: 1, refusals: 1 });
    expect(rows.find((r) => r.reason === "random" && r.substance === "alcohol")).toMatchObject({ tests: 0 });
  });
});

describe("open items and self-audit", () => {
  const now = new Date("2026-06-15T20:00:00Z");

  it("passes a clean program", () => {
    const s = staffed(4);
    s.draws.push({ id: "d1", year: 2026, period: 1, drawnAt: "2026-02-01T00:00:00Z", poolIds: s.people.map((p) => p.id), method: "t", selections: [{ personId: s.people[0]!.id, substance: "drug", testId: "r1" }, { personId: s.people[1]!.id, substance: "alcohol", testId: "r2" }] });
    s.draws.push({ id: "d2", year: 2026, period: 2, drawnAt: "2026-05-01T00:00:00Z", poolIds: s.people.map((p) => p.id), method: "t", selections: [] });
    s.tests.push(test({ id: "r1", personId: s.people[0]!.id, reason: "random", collectedAt: "2026-02-02T20:00:00Z", result: "negative", verifiedOn: "2026-02-04" }));
    s.tests.push(test({ id: "r2", personId: s.people[1]!.id, reason: "random", substance: "alcohol", collectedAt: "2026-02-02T20:00:00Z", result: "negative", verifiedOn: "2026-02-02" }));
    expect(openItems(s, now)).toEqual([]);
    const a = audit(s, now);
    expect(a.filter((i) => i.status === "finding" || i.status === "progress")).toEqual([]);
    expect(a.find((i) => i.id === "mis")?.status).toBe("na");
  });

  it("surfaces each kind of gap, critical first", () => {
    const s = staffed(4);
    s.people[0]!.supervisor = true; // no supervisor training
    s.people[1]!.firstDutyOn = "2026-01-03"; // worked before the verified result
    s.people.push(person({ name: "New Hire" })); // blocked
    s.contractors.push({ id: "c1", name: "Coastline Turbine", work: "Engines", functions: ["maintenance"], coverage: "none" });
    s.contractors.push({ id: "c2", name: "Summit Fuel", work: "Fueling", functions: [], coverage: "none" }); // not safety-sensitive
    s.incidents.push({ id: "i1", kind: "post_accident", personId: s.people[2]!.id, occurredAt: "2026-06-15T19:00:00.000Z", note: "x", testingRequired: true, drugTestId: "e1", alcoholTestId: "e2" });
    s.tests.push(test({ id: "e1", personId: s.people[2]!.id, reason: "post_accident", eventId: "i1" }));
    s.tests.push(test({ id: "e2", personId: s.people[2]!.id, reason: "post_accident", substance: "alcohol", eventId: "i1" }));
    const items = openItems(s, now);
    const titles = items.map((i) => i.title);
    expect(titles).toContain("New Hire is blocked from safety-sensitive duty");
    expect(titles).toContain("Coastline Turbine has no testing coverage on file");
    expect(titles.some((t) => t.includes("Summit Fuel"))).toBe(false);
    expect(titles).toContain(`Drug test clock running: ${s.people[2]!.name}`);
    expect(titles).toContain(`Alcohol test clock running: ${s.people[2]!.name}`);
    expect(titles).toContain(`${s.people[0]!.name} lacks supervisor training`);
    expect(titles).toContain("Random draw for Q2 not run");
    const firstWarning = items.findIndex((i) => i.severity === "warning");
    expect(items.slice(firstWarning).every((i) => i.severity === "warning")).toBe(true);

    const a = Object.fromEntries(audit(s, now).map((i) => [i.id, i.status]));
    expect(a).toMatchObject({ "pre-employment": "finding", "supervisor-training": "finding", contractors: "finding", "event-tests": "progress", clearance: "pass", "random-drug": "progress" });

    // Nine hours later the alcohol window has closed.
    const later = openItems(s, new Date("2026-06-16T04:30:00Z")).map((i) => i.title);
    expect(later).toContain(`Alcohol test window closed: ${s.people[2]!.name}`);
    expect(later).toContain(`Drug test clock running: ${s.people[2]!.name}`);
  });

  it("flags someone working without clearance and an overdue report", () => {
    const { p, t } = cleared({ medical: true });
    const s = state({ people: [p], tests: [t, test({ personId: p.id, reason: "random", result: "positive", verifiedOn: "2026-06-01", collectedAt: "2026-05-30T20:00:00Z" })] });
    const items = openItems(s, now);
    expect(items[0]).toMatchObject({ severity: "critical", title: `${p.name} is performing safety-sensitive duty without clearance` });
    expect(items.find((i) => i.title.startsWith("Report verified positive drug result"))?.detail).toBe("Due 2026-06-03 (overdue).");
    expect(audit(s, now).find((i) => i.id === "reports")?.status).toBe("finding");
  });
});
