import type { FormSection } from "@/core/fields";
import type { ReviewSection } from "@/core/product";
import type { Rule } from "@/core/rules";
import type { ScheduleFacts, ScheduleModule } from "./common";
import { scheduleA } from "./schedule-a";
import { scheduleB } from "./schedule-b";
import { scheduleC } from "./schedule-c";
import { scheduleD } from "./schedule-d";
import { scheduleE } from "./schedule-e";
import { scheduleF } from "./schedule-f";
import { scheduleG } from "./schedule-g";
import { scheduleI } from "./schedule-i";
import { scheduleJ } from "./schedule-j";
import { scheduleL } from "./schedule-l";
import { scheduleM } from "./schedule-m";
import { scheduleN } from "./schedule-n";
import { scheduleR } from "./schedule-r";

export type { ScheduleFacts } from "./common";
export { applyEventSplit, eventContributions } from "./schedule-g";

/**
 * Schedules in build order. Schedule A runs before B because Schedule B's special
 * rule depends on Schedule A's support test.
 */
export const SCHEDULE_MODULES: ScheduleModule<any>[] = [
  scheduleA, scheduleB, scheduleC, scheduleD, scheduleE, scheduleF, scheduleG, scheduleI, scheduleJ, scheduleL, scheduleM, scheduleN, scheduleR,
];

/** Intake questions for every schedule, appended to the Form 990 intake. */
export const SCHEDULE_INTAKE: FormSection[] = SCHEDULE_MODULES.flatMap((m) => m.intake);

/**
 * Builds each listed module whose key is in `keys` (or every module when `keys` is
 * omitted), in order, adding each output to `outputs` so later modules can read it.
 */
export function buildModules(
  modules: ScheduleModule<any>[],
  facts: Omit<ScheduleFacts, "outputs">,
  outputs: Record<string, unknown>,
  keys?: Set<string>,
): Record<string, unknown> {
  for (const m of modules) if (!keys || keys.has(m.schedule)) outputs[m.schedule] = m.build({ ...facts, outputs });
  return outputs;
}

/** Module rules adapted to any context that can produce facts and outputs; a rule runs only when its module was built. */
export function moduleRules<C>(
  modules: ScheduleModule<any>[],
  prefix: string,
  select: (ctx: C) => { facts: ScheduleFacts; outputs: Record<string, unknown> },
): Rule<C>[] {
  return modules.flatMap((m) =>
    m.rules.map((r) => ({
      ...r,
      id: `${prefix}${r.id}`,
      check: (ctx: C) => {
        const { facts, outputs } = select(ctx);
        if (!(m.schedule in outputs)) return;
        return r.check({ facts, out: outputs[m.schedule] });
      },
    })),
  );
}

export function renderModules(modules: ScheduleModule<any>[], facts: ScheduleFacts, outputs: Record<string, unknown>): ReviewSection[] {
  return modules.flatMap((m) => (m.schedule in outputs ? m.render(outputs[m.schedule], facts) : []));
}
