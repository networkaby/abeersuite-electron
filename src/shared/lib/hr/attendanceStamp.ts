/**
 * The till's half of attendance — best-effort, never in the way of a sign-in.
 *
 * Owner, 2026-09-18: attendance is auto from the counter sign-in. The first
 * sign-in of the business day writes PRESENT with the in time; every later one
 * leaves the row alone (a re-login after lunch is not a second arrival). The
 * shift close stamps the out time. Both swallow their own errors: a person who
 * cannot be marked present must still be able to sell.
 *
 * 2026-09-22: the sign-in is not the only arrival. It needs `COUNTER_MACHINE_ID`
 * AND the counter setup file, and when either is missing the stamp is skipped in
 * silence — on 21 Sep that left a real day (user 38, counter 1) with an out time
 * at 15:09 and no arrival at all, although their shift had opened at 05:02 and
 * said so. So the SHIFT now stamps too: it reads its counter from the database
 * and cannot be misconfigured away. Sign-in still wins when it fires, because it
 * is the earlier and truer arrival — everything below only ever fills a blank.
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

/**
 * The out time, from the shift close.
 *
 * `openedAt` / `counterId` are the shift's own — the fallback arrival for a day
 * whose sign-in stamp never ran. Without them the close used to create a row
 * reading PRESENT with no arrival, which the register then showed as a blank
 * in-time: present since never. Passing them cannot overwrite a real sign-in,
 * because the arrival is only ever written where it is still null.
 */
export async function stampAttendanceOut(
    db: Db,
    userId: number,
    at = new Date(),
    shift?: { openedAt: Date; counterId: number },
): Promise<void> {
    try {
        const date = dayOf(businessTodayIso(at));
        await db.attendanceDay.upsert({
            where:  { userId_date: { userId, date } },
            create: {
                userId, date, status: "PRESENT", source: "COUNTER", lastOutAt: at,
                firstInAt: shift?.openedAt ?? null,
                counterId: shift?.counterId ?? null,
            },
            update: { lastOutAt: at },
        }).catch(() => undefined);

        // The row already existed but carries no arrival — the sign-in stamp was
        // skipped on this till. Fill it from the shift open, never over a real one.
        if (shift) {
            await db.attendanceDay.updateMany({
                where: { userId, date, firstInAt: null },
                data:  { firstInAt: shift.openedAt, counterId: shift.counterId },
            }).catch(() => undefined);
        }
    } catch { /* never fail the close */ }
}
