// How a day looks. Shared by the office register and the staff's own page, so a
// green cell means the same thing on both and a colour can only be changed once.

import type { AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";

export const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export const CELL: Record<AttendanceStatus, string> = {
    PRESENT:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    HALF_DAY:   "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    ABSENT:     "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
    LEAVE:      "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    WEEKLY_OFF: "bg-muted text-muted-foreground",
    HOLIDAY:    "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
};
