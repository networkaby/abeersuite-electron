/**
 * "How was my day?" — the shape of the counter's own duty card, and the small
 * handoff that carries it across a sign-out.
 *
 * Owner, 2026-09-22: the man at the till should be able to assess his own work.
 * Every one of these numbers was already being measured (dutyTime.ts) and shown
 * only in the office register — the person being graded was the one person who
 * could not see the grade.
 *
 * Client-safe on purpose: the login screen is a public page and must be able to
 * read this without pulling a server module in behind it.
 */

import type { NextOfficeDay } from "./seasonalHours";

/** The month's overtime after the make-up. See modules/hr/lib/monthlyOvertime.ts. */
export type MonthOvertime = {
    month: string;
    surplusMinutes: number;
    /** Of the surplus, the part worked on his own weekly offs. */
    weeklyOffMinutes: number;
    shortfallMinutes: number;
    madeUpMinutes: number;
    payableMinutes: number;
    owedMinutes: number;
};

export type MyDay = {
    tracked: boolean;
    date: string;
    counterName: string | null;
    firstInAt: string | null;
    workedMinutes: number;
    dutyMinutes: number;
    dutyStart: string;
    dutyEnd: string;
    lateMinutes: number | null;
    /** Duty owed but not worked — the idle stretches and the late start, netted. */
    shortMinutes: number;
    overtimeMinutes: number;
    grade: "PRESENT" | "HALF_DAY" | "ABSENT";
    /** True when the office marked the day by hand — their word beats the clock. */
    officeMarked: boolean;
    month: MonthOvertime;
    /**
     * When he is next on duty, and at what time — his own weekly off and the
     * shop's holidays already taken out, and the opening already on the season's
     * curve. Optional because a card stashed by an older build has no such field,
     * and a returning cashier should still see his day rather than a blank screen.
     */
    nextDuty?: NextOfficeDay;
    /**
     * Today as it was lived, in order — the on / off stretches the office's day
     * card draws (attendanceBreakup.ts `buildTimeline`), for the lock screen's
     * timeline. An `off` line is a gap past his idle limit: away. Optional for the
     * same reason as `nextDuty`.
     */
    lived?: { kind: "on" | "off"; from: string; to: string; open?: boolean }[];
    /**
     * The day's moments, for the timeline's flags (owner, 2026-10-14: *"join,
     * leave, shift open, shift close in time line"*). `in` / `out` are his own
     * sign-ins and sign-outs, read off the stretches; the shift ones are his
     * shifts on any till that day. A lock is not a leave and is not here.
     */
    events?: { kind: "in" | "out" | "shiftOpen" | "shiftClose" | "handover"; at: string }[];
};

/**
 * Where the card waits between the sign-out and the login screen.
 *
 * `sessionStorage`, not a query string: the figures are the person's own working
 * hours and have no business in an address bar, a history entry or a log line.
 * It dies with the tab, which is exactly the life it should have.
 */
const KEY = "abeer.myDay";

/**
 * Take the reading, then hand it to the login screen.
 *
 * Called immediately BEFORE `signOut()`, while the session is still good. Two
 * steps: credit the tail, then read the card.
 *
 * `lastInputAt` is the instant of his last real click or keypress, which only the
 * browser knows, and it is what makes the tail credit honest on BOTH ways out.
 * Pulses land every few minutes, so the work between the final pulse and the
 * final keypress was being thrown away — and on an idle sign-out it was lost for
 * certain, because by then the gap to now exceeds the idle limit and the server
 * credits nothing. Passing the instant instead of relying on "now" fixes both.
 * The server clamps it to now and still caps it at the idle limit, so it can only
 * ever credit less than omitting it would (see stampActivity).
 *
 * Nothing here may delay a sign-out for long, and nothing here may prevent one.
 * A till that cannot reach the server must still be able to let go of the person
 * standing at it, so the whole thing is behind a short timeout and every error is
 * swallowed: no card is a fine outcome, a stuck sign-out is not.
 */
export async function captureMyDay(
    { lastInputAt, timeoutMs = 4000 }: { lastInputAt?: number | null; timeoutMs?: number } = {},
): Promise<void> {
    if (typeof window === "undefined") return;
    try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
            await fetch("/api/hr/activity", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(lastInputAt ? { lastInputAt: new Date(lastInputAt).toISOString() } : {}),
                signal: ac.signal,
            }).catch(() => undefined);
            const res = await fetch("/api/hr/my-day", { signal: ac.signal });
            if (!res.ok) return;
            const day = await res.json() as MyDay;
            if (!day?.tracked) return;    // off a counter nothing is measured — show nothing
            window.sessionStorage.setItem(KEY, JSON.stringify(day));
        } finally {
            clearTimeout(timer);
        }
    } catch { /* a sign-out is never held up by a clock */ }
}

/**
 * Read the card once and take it away — it belongs to the sign-out that wrote it.
 *
 * Shaped as an external store rather than a `useState` filled from an effect,
 * because that is honestly what it is: a value living outside React, in
 * sessionStorage, that this page samples once. The snapshot is memoised on first
 * read so React's repeated calls see a stable value — and so the storage entry is
 * consumed exactly once however many times the component renders.
 */
let snapshot: MyDay | null | undefined;

function readOnce(): MyDay | null {
    if (snapshot !== undefined) return snapshot;
    snapshot = null;
    try {
        const raw = window.sessionStorage.getItem(KEY);
        if (raw) {
            window.sessionStorage.removeItem(KEY);
            snapshot = JSON.parse(raw) as MyDay;
        }
    } catch { /* private mode, blocked storage — no card, no crash */ }
    return snapshot;
}

/** Nothing ever changes after the first read, so there is nothing to subscribe to. */
const noSubscribe = () => () => { };

export const myDayStore = {
    subscribe: noSubscribe,
    getSnapshot: readOnce,
    /** The server has no sessionStorage and must render the same nothing the first
     *  client paint does, or the page hydrates with a card the server never drew. */
    getServerSnapshot: (): MyDay | null => null,
};
