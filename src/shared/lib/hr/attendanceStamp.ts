/**
 * The till's half of attendance — best-effort, never in the way of a sign-in.
 *
 * Owner, 2026-09-18: attendance is auto from the counter sign-in. The first
 * sign-in of the business day writes PRESENT with the in time; every later one
 * leaves the row alone (a re-login after lunch is not a second arrival). The
 * shift close stamps the out time. Both swallow their own errors: a person who
 * cannot be marked present must still be able to sell.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

type Db = Pick<PrismaClient, "attendanceDay">;

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function stampAttendanceIn(db: Db, userId: number, counterId: number, at = new Date()): Promise<void> {
    try {
        const date = dayOf(businessTodayIso(at));
        await db.attendanceDay.upsert({
            where: { userId_date: { userId, date } },
            create: { userId, date, status: "PRESENT", source: "COUNTER", firstInAt: at, counterId },
            // An office mark already made today stands; only the clock is filled in.
            update: { firstInAt: at, counterId },
        }).catch(() => undefined);
    } catch { /* never fail the sign-in */ }
}

export async function stampAttendanceOut(db: Db, userId: number, at = new Date()): Promise<void> {
    try {
        const date = dayOf(businessTodayIso(at));
        await db.attendanceDay.upsert({
            where: { userId_date: { userId, date } },
            create: { userId, date, status: "PRESENT", source: "COUNTER", lastOutAt: at },
            update: { lastOutAt: at },
        }).catch(() => undefined);
    } catch { /* never fail the close */ }
}
