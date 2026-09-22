// The wire shape of the hours breakup, kept away from the server loader so the
// dialog can import it without dragging Prisma into the browser bundle.

import type { DayBreakup } from "./attendanceBreakup";

export interface HoursPayload {
    userId: number;
    userName: string;
    from: string;
    to: string;
    days: DayBreakup[];
}
