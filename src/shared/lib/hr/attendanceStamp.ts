/**
 * The till's half of attendance — best-effort, never in the way of a sign-in.
 *
 * Owner, 2026-09-18: attendance is auto from the counter sign-in. The first
 * sign-in of the business day writes PRESENT with the in time; every later one
 * leaves the row alone (a re-login after lunch is not a second arrival). The
 * shift close stamps the out time. Both swallow their own errors: a person who
 * cannot be marked present must still be able to sell.
 *
 * 2026-09-22: the sign-in is the wrong event to hang a daily mark on. It used to be
 * worse — a session lasted 30 days and rolled on use, so a till worked every day was
 * never signed out and `authorizeStaffCredentials`, the only thing that stamped an
 * arrival, did not run on the other days. src/auth.ts now ends a session after 8 idle
 * hours, which puts the sign-in back every morning; the stamp below is still not
 * enough on its own, because a sign-in is a person and a day is a shift. On
 * live, user 38 last signed in on 19 Sep and worked counter 1 on the 20th and 21st;
 * the 21st was stored as an out time at 15:09 with no arrival at all, although the
 * shift had opened at 05:02 and said so. (It is NOT a misconfigured till: the same
 * `thisCounterId()` gate guards stampCounterPinLogin, and that machine's PIN row
 * updated fine.) So the SHIFT stamps too — opening a till is a daily event and reads
 * its counter from the database. Sign-in still wins when it fires, because it is the
 * earlier and truer arrival; everything below only ever fills a blank.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { IDLE_LIMIT_MS, creditableMinutes } from "@/shared/lib/hr/dutyTime";
import { closeOpenSpan, openSpanOnArrival, recordSpanBeat } from "@/shared/lib/hr/attendanceSpans";

/**
 * The day row is the balance; the spans are the ledger behind it. Every write
 * below keeps both, and the span half is written SECOND and swallows its own
 * errors, so the number people are paid on can never fail because its explanation
 * did. See attendanceSpans.ts.
 */
type Db = Pick<PrismaClient, "attendanceDay" | "attendanceSpan">;

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
            data:  { firstInAt: at, counterId, lastSeenAt: at },
        });
        if (filled.count > 0) {
            await openSpanOnArrival(db, userId, date, at, counterId);
            return;
        }

        // Either today has no row yet, or it already carries an arrival time.
        // An office mark made earlier today stands either way — `update: {}`
        // deliberately changes nothing.
        await db.attendanceDay.upsert({
            where:  { userId_date: { userId, date } },
            create: { userId, date, status: "PRESENT", source: "COUNTER", firstInAt: at, counterId, lastSeenAt: at },
            update: {},
        }).catch(() => undefined);
        // A re-login inside a live stretch opens nothing — see openSpanOnArrival.
        await openSpanOnArrival(db, userId, date, at, counterId);
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

        // Closing the till is itself a sign of life, so the stretch since the last
        // one is worked time — otherwise a quiet last hour at the counter would be
        // thrown away. Same rule as everywhere else: a gap longer than the idle
        // limit means they were not there, and adds nothing.
        const prior = await db.attendanceDay.findUnique({
            where:  { userId_date: { userId, date } },
            select: { lastSeenAt: true },
        }).catch(() => null);
        const add = creditableMinutes(prior?.lastSeenAt ?? null, at);
        await db.attendanceDay.update({
            where: { userId_date: { userId, date } },
            data:  { lastSeenAt: at, workedMinutes: { increment: add } },
        }).catch(() => undefined);
        // The same minutes on the ledger, and the stretch ends here: closing the
        // till is the end of the working day, not an idle gap.
        await closeOpenSpan(db, userId, date, at, add, "SHIFT_CLOSED");

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

/**
 * A sign of life: somebody is actually using this machine right now.
 *
 * Called by the client every few minutes WHILE THERE IS REAL INPUT — never from a
 * poll, or it would credit an empty counter. Each call adds the gap since the last
 * sign of life, and `creditableMinutes` drops any gap longer than the idle limit,
 * so a stretch where nobody was there adds nothing. That is the whole of "the idle
 * time is treated as absent", and it does not depend on the auto-logout having
 * fired: a PC left switched on overnight simply contributes one ignored gap.
 *
 * Read-then-write rather than a bare increment, because the amount to add depends
 * on the value already stored. Two pings landing together can only over-credit by
 * one interval, which is not worth a transaction on this hot a path.
 *
 * `lastInputAt` is the instant of the caller's LAST REAL KEYPRESS OR CLICK, which
 * only the client knows. Passing it fixes both ends of the same error:
 *
 *   • the tail — pulses land every few minutes, so up to one interval of genuine
 *     work between the final pulse and the final keypress was being thrown away.
 *     On an idle sign-out it was lost for certain, because by then the gap to now
 *     exceeds the limit and credits nothing at all.
 *   • the head — a person who idles twenty minutes and THEN clicks Sign out was
 *     credited all twenty, because the gap to now was still inside the limit.
 *
 * It cannot be used to inflate a day. The value is clamped to `at`, so it can only
 * ever credit LESS than the plain call would, and the idle-limit cap still applies
 * on top. A client that lies can only rob itself — which is the right direction for
 * a number the client supplies and the wage depends on.
 *
 * Returns the day's running total, so the screen can show it without a second read.
 */
export async function stampActivity(
    db: Db,
    userId: number,
    counterId: number | null,
    at = new Date(),
    idleLimitMs = IDLE_LIMIT_MS,
    lastInputAt?: Date | null,
): Promise<number> {
    try {
        const date = dayOf(businessTodayIso(at));
        // Never the future, and never a moment already counted. Bad input simply
        // falls back to `at`, the behaviour before this argument existed.
        const seenAt =
            lastInputAt && !Number.isNaN(lastInputAt.getTime()) && lastInputAt.getTime() <= at.getTime()
                ? lastInputAt
                : at;
        const row = await db.attendanceDay.findUnique({
            where:  { userId_date: { userId, date } },
            select: { lastSeenAt: true, workedMinutes: true, source: true },
        });

        // Nothing yet today — the first sign of life IS the arrival. This is the
        // path for anyone who works without opening a till at all.
        if (!row) {
            await db.attendanceDay.create({
                data: { userId, date, status: "PRESENT", source: "COUNTER", firstInAt: at, lastSeenAt: seenAt, counterId },
            }).catch(() => undefined);
            await recordSpanBeat(db, userId, date, null, at, 0, counterId);
            return 0;
        }

        // A late-arriving request must not drag the clock backwards — two pulses can
        // cross, and the older one's `lastInputAt` would then un-count real minutes.
        const movedForward = !row.lastSeenAt || seenAt.getTime() > row.lastSeenAt.getTime();
        const add = movedForward ? creditableMinutes(row.lastSeenAt, seenAt, idleLimitMs) : 0;
        await db.attendanceDay.update({
            where: { userId_date: { userId, date } },
            data:  movedForward
                ? { lastSeenAt: seenAt, workedMinutes: { increment: add } }
                : { workedMinutes: { increment: 0 } },
        });
        // The ledger takes exactly what the balance took. A beat that moved
        // nothing forward is a crossed pulse, already counted — it must not break
        // the stretch, so it is not put on the ledger either.
        if (movedForward) await recordSpanBeat(db, userId, date, row.lastSeenAt, seenAt, add, counterId);
        return row.workedMinutes + add;
    } catch {
        return 0;   /* never fail a page over a clock */
    }
}
