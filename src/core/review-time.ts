/**
 * Reviewer time is the pilot's success measure: a full Form 990 must take a credentialed
 * reviewer under 6 hours. Time accrues while a timer runs and from manual entries for work
 * done outside the platform (for example, keying the return into e-file software).
 */

/** A timer left running is capped so one forgotten session cannot distort the measure. */
export const MAX_TIMER_SECONDS = 4 * 60 * 60;

export const MAX_MANUAL_MINUTES = 8 * 60;

export function elapsedSeconds(startedAt: Date, now: Date = new Date()): number {
  const s = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
  return Math.min(Math.max(s, 0), MAX_TIMER_SECONDS);
}

/** "1 h 05 m", "42 m", "0 m" */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

export const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
