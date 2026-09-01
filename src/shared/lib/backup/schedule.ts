/**
 * Is right now a moment the backup should run?
 *
 * The GitHub tick fires hourly and asks this. Kept here, away from the route, so the
 * rule can be read and tested on its own — it is the one piece of logic that decides
 * whether the business has backups.
 *
 * Everything is IST: the stored weekdays and hours are IST, and `now` is converted
 * once here. That keeps "Sunday" meaning Sunday to the person who picked it, rather
 * than Saturday evening UTC.
 */

/** IST is a fixed +5:30 — no daylight saving, so shifting the clock is exact. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface BackupSchedule {
    enabled: boolean;
    weekdays: number[];
    hours: number[];
    lastRunAt: Date | null;
}

export interface DueResult {
    due: boolean;
    /** Shown in the workflow log, so a skipped run says why rather than just ending. */
    reason: string;
}

/** IST calendar fields for an instant. */
export function istParts(now: Date): { weekday: number; hour: number; dayKey: string } {
    const d = new Date(now.getTime() + IST_OFFSET_MS);
    return {
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
        dayKey: `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`,
    };
}

export function isDue(schedule: BackupSchedule, now: Date): DueResult {
    if (!schedule.enabled) return { due: false, reason: "automatic backup is switched off" };

    const { weekday, hour } = istParts(now);

    if (!schedule.weekdays.includes(weekday)) {
        return { due: false, reason: `not a backup day (IST weekday ${weekday})` };
    }
    if (!schedule.hours.includes(hour)) {
        return { due: false, reason: `not a backup hour (IST hour ${hour})` };
    }

    // GitHub can start a queued run late, and can retry one. Without this, a run that
    // slipped into the same hour twice would produce two full dumps.
    if (schedule.lastRunAt) {
        const last = istParts(schedule.lastRunAt);
        const nowParts = istParts(now);
        if (last.dayKey === nowParts.dayKey && last.hour === nowParts.hour) {
            return { due: false, reason: "already backed up in this hour" };
        }
    }

    return { due: true, reason: `IST weekday ${weekday}, hour ${hour}` };
}
