import type { FormSection } from "@/core/fields";
import type { ReviewSection } from "@/core/product";
import type { Rule } from "@/core/rules";
import type { ScheduleFacts, ScheduleModule } from "./common";
import { scheduleA } from "./schedule-a";
import { scheduleB } from "./schedule-b";
import { scheduleC } from "./schedule-c";
import { scheduleD } from "./schedule-d";
import { scheduleF } from "./schedule-f";
import { scheduleG } from "./schedule-g";
import { scheduleI } from "./schedule-i";
import { scheduleJ } from "./schedule-j";
import { scheduleL } from "./schedule-l";
import { scheduleM } from "./schedule-m";
import { scheduleR } from "./schedule-r";

export type { ScheduleFacts } from "./common";
export { applyEventSplit, eventContributions } from "./schedule-g";

/**
 * Schedules in build order. Schedule A runs before B because Schedule B's special
 * rule depends on Schedule A's support test.
 */
export const SCHEDULE_MODULES: ScheduleModule<any>[] = [
  scheduleA, scheduleB, scheduleC, scheduleD, scheduleF, scheduleG, scheduleI, scheduleJ, scheduleL, scheduleM, scheduleR,
];

/** Intake questions for every schedule, appended to the Form 990 intake. */
export const SCHEDULE_INTAKE: FormSection[] = SCHEDULE_MODULES.flatMap((m) => m.intake);

/** Builds each triggered schedule that has a module; returns outputs keyed by schedule letter. */
export function buildScheduleDetail(facts: Omit<ScheduleFacts, "outputs">, letters: Set<string>): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const m of SCHEDULE_MODULES) if (letters.has(m.schedule)) outputs[m.schedule] = m.build({ ...facts, outputs });
  return outputs;
}

/** Schedule rules adapted to any context that can produce facts and outputs; rules only run for built schedules. */
export function scheduleRules<C>(select: (ctx: C) => { facts: ScheduleFacts; outputs: Record<string, unknown> }): Rule<C>[] {
  return SCHEDULE_MODULES.flatMap((m) =>
    m.rules.map((r) => ({
      ...r,
      id: `sched_${r.id}`,
      check: (ctx: C) => {
        const { facts, outputs } = select(ctx);
        if (!(m.schedule in outputs)) return;
        return r.check({ facts, out: outputs[m.schedule] });
      },
    })),
  );
}

export function renderScheduleDetail(facts: ScheduleFacts, outputs: Record<string, unknown>): ReviewSection[] {
  return SCHEDULE_MODULES.flatMap((m) => (m.schedule in outputs ? m.render(outputs[m.schedule], facts) : []));
}
