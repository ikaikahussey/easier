import { addDays, workweekOf } from "@/domains/payroll/compute";

/** Schedule and timesheet pages show one Monday-to-Sunday week at a time. */
export const WEEK_START = 1;
export const thisWeek = () => workweekOf(new Date().toISOString().slice(0, 10), WEEK_START);
export const weekFrom = (raw: string | undefined) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? workweekOf(raw, WEEK_START) : thisWeek());
export const weekDays = (week: string) => Array.from({ length: 7 }, (_, i) => addDays(week, i));
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayName = (iso: string) => DAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
