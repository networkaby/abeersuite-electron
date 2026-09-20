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

        // FIRST in, and it has to stay the first: a plain upsert overwrote
        // `firstInAt` on every sign-in, so a re-login after lunch rewrote the
        // morning arrival and the field became "last seen" under a name that
        // says the opposite. The conditional update only fills a blank clock;
        // when a time is already there today, the arrival stands.
        const filled = await db.attendanceDay.updateMany({
            where: { userId, date, firstInAt: null },
            data:  { firstInAt: at, counterId },
        });
        if (filled.count > 0) return;

        // Either today has no row yet, or it already carries an arrival time.
        // An office mark made earlier today stands either way — `update: {}`
        // deliberately changes nothing.
        await db.attendanceDay.upsert({
            where:  { userId_date: { userId, date } },
            create: { userId, date, status: "PRESENT", source: "COUNTER", firstInAt: at, counterId },
            update: {},
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
