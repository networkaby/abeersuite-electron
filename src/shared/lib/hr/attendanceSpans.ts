/**
 * The day taken apart — one row per stretch a person was actually active.
 *
 * Owner, 2026-09-22: *"we need to know how many time he/she was active, how the
 * day is calculated, hour breakup user wise day wise."*
 *
 * `AttendanceDay.workedMinutes` is a running total and a total cannot be taken
 * apart again — 8h 10m says nothing about whether it was one stretch or five, nor
 * when they were. So each stretch is written as it happens, and the day row is
 * left exactly as it was: it is still what the register, the grading and payroll
 * read. These rows only ever EXPLAIN that number, never replace it, which is why
 * nothing working today can break if a span is missed.
 *
 * The rule is not a new one. It is the rule already in `creditStep`, said
 * out loud: every sign of life extends the open stretch, and a gap longer than the
 * person's idle limit means they were not here — the open stretch is closed at its
 * own last sign of life, and a fresh one starts where they came back.
 *
 *   10:30 … 14:00   (last touch)      → span 1, 3h 30m, ended IDLE
 *   16:00 … 20:40   (last touch)      → span 2, 4h 40m, closed at read time
 *
 * Signing in or out and opening or closing a shift are signs of life like any
 * other (owner, 2026-10-13) — none of them ends a stretch. Back inside the limit
 * is the same stretch; only a gap past it breaks one.
 *
 * The two hours between 14:00 and 16:00 are
 * stored nowhere — they are not time worked, they are simply the space between
 * two spans, and the breakup reads the idle figure as that difference.
 *
 * Every function here swallows its own errors, for the same reason the stamping
 * does: a clock must never break a screen, and an explanation must never cost
 * somebody a sale.
 */

import type { PrismaClient } from "@/generated/prisma/client";

type Db = Pick<PrismaClient, "attendanceSpan">;

/**
 * Why a stretch finished. `OPEN` while it is still running. SIGNED_OUT and
 * SHIFT_CLOSED are no longer written (2026-10-13) — kept for the old rows.
 */
export type SpanEnd = "OPEN" | "IDLE" | "SIGNED_OUT" | "SHIFT_CLOSED";

/**
 * The stretch still running for this person today, if any.
 *
 * There is at most one — every path that opens a span closes the previous one
 * first. `orderBy` is belt and braces: if two ever existed, the later is the live
 * one and the older is stale, so extending the latest is the safe answer.
 */
async function openSpan(db: Db, userId: number, date: Date) {
    return db.attendanceSpan.findFirst({
        where:   { userId, date, endedAt: null },
        orderBy: { startedAt: "desc" },
        select:  { id: true, minutes: true, startedAt: true },
    }).catch(() => null);
}

/**
 * A sign of life landed — put it on the ledger.
 *
 * `credited` is the minutes the day row just accepted for this beat and `away`
 * whether the gap was past the idle limit — both from `creditStep`, passed in
 * rather than recomputed, so the ledger can never disagree with the balance.
 * Only `away` breaks the stretch: the open one is closed at `lastActive` — the
 * previous sign of life, the last moment anybody was really there — and a new
 * one opens at `seenAt`. A beat that credits nothing but is not away (two beats
 * inside a minute) is the same stretch; breaking there is what used to litter a
 * day with 0m pieces.
 *
 * `lastActive` null means nothing has been seen today at all, so there is nothing
 * to close and the first stretch simply begins.
 */
export async function recordSpanBeat(
    db: Db,
    userId: number,
    date: Date,
    lastActive: Date | null,
    seenAt: Date,
    credited: number,
    away: boolean,
    counterId: number | null,
): Promise<void> {
    try {
        const open = await openSpan(db, userId, date);

        if (open && !away) {
            // Still the same stretch — it just grew.
            if (credited > 0) {
                await db.attendanceSpan.update({
                    where: { id: open.id },
                    data:  { minutes: { increment: credited } },
                }).catch(() => undefined);
            }
            return;
        }

        if (open) {
            // Away longer than the limit: the old stretch ended at its last sign
            // of life, not at this one — and never before it began, which a
            // stretch opened by a sign-in after that last sign of life would.
            const end = lastActive && lastActive > open.startedAt ? lastActive : open.startedAt;
            await db.attendanceSpan.update({
                where: { id: open.id },
                data:  { endedAt: end, endedBy: "IDLE" },
            }).catch(() => undefined);
            await db.attendanceSpan.create({
                data: { userId, date, startedAt: seenAt, minutes: 0, counterId, endedBy: "OPEN" },
            }).catch(() => undefined);
            return;
        }

        // No stretch running. Usually the first beat of the day — but it can also
        // be a day whose row was made by something that opens no span (an office
        // mark typed this morning), and then the balance has just taken minutes
        // the ledger would otherwise throw away. So the new stretch starts where
        // those minutes started, and carries them.
        await db.attendanceSpan.create({
            data: {
                userId, date,
                startedAt: credited > 0 && lastActive ? lastActive : seenAt,
                minutes: credited > 0 ? credited : 0,
                counterId, endedBy: "OPEN",
            },
        }).catch(() => undefined);
    } catch { /* a ledger must never break the clock it explains */ }
}

/**
 * Begin a stretch because somebody arrived — a sign-in, or a till's shift open.
 *
 * Only ever opens one where none is running. An arrival in the middle of a live
 * stretch is a re-login after lunch, not a second arrival, and splitting the
 * stretch there would invent a break that never happened.
 */
export async function openSpanOnArrival(
    db: Db, userId: number, date: Date, at: Date, counterId: number | null,
): Promise<void> {
    try {
        if (await openSpan(db, userId, date)) return;
        await db.attendanceSpan.create({
            data: { userId, date, startedAt: at, minutes: 0, counterId, endedBy: "OPEN" },
        }).catch(() => undefined);
    } catch { /* never fail an arrival */ }
}
