import type { FormSection } from "@/core/fields";
import type { ScheduleModule } from "../schedules/common";
import { header } from "./header";
import { partIV } from "./part-iv";
import { partV } from "./part-v";
import { partVI } from "./part-vi";
import { partVII } from "./part-vii";
import { partXI } from "./part-xi-xii";

export type { HeaderIntake } from "./header";
export type { PartIVIntake } from "./part-iv";
export type { PartVIntake } from "./part-v";
export type { PartVIIntake } from "./part-vi";
export type { PartXIIntake } from "./part-xi-xii";

/** Core-form parts built before the schedules (their outputs feed schedule triggers and facts). */
export const PRE_SCHEDULE_PARTS: ScheduleModule<any>[] = [header, partVII];
/** Core-form parts built after the schedules (Part IV reads what was triggered). */
export const POST_SCHEDULE_PARTS: ScheduleModule<any>[] = [partIV, partV, partVI, partXI];
export const PART_MODULES = [...PRE_SCHEDULE_PARTS, ...POST_SCHEDULE_PARTS];

/** Intake sections for the core-form parts, in form order; the header goes first. */
export const HEADER_INTAKE: FormSection[] = header.intake;
export const PART_INTAKE: FormSection[] = [partVII, partIV, partV, partVI, partXI].flatMap((m) => m.intake);
