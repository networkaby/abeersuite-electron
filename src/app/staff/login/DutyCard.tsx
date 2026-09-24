"use client";

import { useSyncExternalStore } from "react";
import { formatClockTime } from "@/shared/lib/format/formatDate";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { myDayStore } from "@/shared/lib/hr/myDay";
import { nextOpeningText } from "@/shared/lib/hr/nextOpeningText";
import styles from "./login.module.css";

/**
 * "Your duty today" — the day he just finished, handed back to the man who worked it.
 *
 * It shows on the LOGIN screen rather than in a dialog before the sign-out, and that
 * is a decision, not a convenience. A counter session ends two ways, and the common
 * one is the idle auto-logout — nobody is standing there to read a dialog, and it
 * would be clicked away blind by whoever arrives next. On the login screen the
 * deliberate sign-out reads it on his way out, and the idle one reads it the moment
 * he comes back to the till. It is taken as it is read, so it is shown once.
 *
 * Counter only — off a till nothing is measured (TRACK_OFF_COUNTER), the capture
 * stores nothing, and this renders nothing rather than a confident empty day.
 */
export default function DutyCard() {
    // sessionStorage is outside React and has no server value, so it is read as an
    // external store: the server and the first client paint both draw nothing, and
    // the card appears on hydration. The read consumes the entry exactly once.
    const day = useSyncExternalStore(
        myDayStore.subscribe, myDayStore.getSnapshot, myDayStore.getServerSnapshot,
    );

    if (!day) return null;

    const verdict =
        day.grade === "PRESENT"  ? "Counted as a full day"
      : day.grade === "HALF_DAY" ? "Counted as a half day"
      :                            "Not counted as a day";

    const m = day.month;
    // How much of the duty was worked, for the bar. A day off has no duty to fill,
    // so it gets no bar rather than one stuck at empty or full.
    const filled = day.dutyMinutes > 0 ? Math.min(100, (day.workedMinutes / day.dutyMinutes) * 100) : null;

    return (
        <section className={styles.duty}>
            <p className={styles.dutyhead}>
                Your duty today{day.counterName ? ` · ${day.counterName}` : ""}
            </p>

            <p className={styles.dutybig}>{formatWorked(day.workedMinutes)}</p>
            <p className={styles.dutysub}>
                worked of {formatWorked(day.dutyMinutes)} duty
                {day.firstInAt ? ` · in at ${formatClockTime(day.firstInAt)}` : ""}
            </p>
            {filled !== null && (
                <div className={styles.dutybar}><i style={{ width: `${filled}%` }} /></div>
            )}

            <dl className={styles.dutyrows}>
                {day.overtimeMinutes > 0 && (
                    <div><dt>Overtime</dt><dd>{formatWorked(day.overtimeMinutes)}</dd></div>
                )}
                {day.shortMinutes > 0 && (
                    <div><dt>Away during duty</dt><dd>{formatWorked(day.shortMinutes)}</dd></div>
                )}
                {day.lateMinutes ? (
                    <div><dt>Late</dt><dd>{formatWorked(day.lateMinutes)}</dd></div>
                ) : null}
            </dl>

            <p className={day.grade === "PRESENT" ? styles.dutygood : styles.dutywarn}>
                {verdict}
                {/* The office always overrules the clock — saying so here stops the
                    screen from sounding like a final word it is not. */}
                {day.officeMarked ? " — marked by the office" : ""}
            </p>

            {/* ── The month, after the make-up ──────────────────────────────────
                A day's extra hour is not money on its own: it first pays back the
                hours fallen short on other days. Only what survives that is real
                overtime, and only that attracts extra payment. */}
            <p className={styles.dutymonth}>
                {m.surplusMinutes === 0 && m.shortfallMinutes === 0
                    ? "This month: on duty, nothing over and nothing owed."
                    : m.owedMinutes > 0
                        ? `This month: ${formatWorked(m.surplusMinutes)} overtime against ${formatWorked(m.shortfallMinutes)} short — ${formatWorked(m.owedMinutes)} still to make up.`
                        : m.payableMinutes > 0
                            ? `This month: ${formatWorked(m.madeUpMinutes)} made up, ${formatWorked(m.payableMinutes)} overtime payable.`
                            : "This month: shortfall fully made up, nothing extra yet."}
                {/* A day off worked is all surplus — but it pays back the short
                    hours first, so saying it out loud stops "I came on Sunday"
                    from being read as money that is not there. */}
                {m.weeklyOffMinutes > 0 ? ` Includes ${formatWorked(m.weeklyOffMinutes)} on your day off.` : ""}
            </p>

            {/* ── Next time to start duty ───────────────────────────────────────
                The slot the last session left here, now filled. It is HIS next
                working day, not the shop's: his own weekly off and the holidays are
                already taken out server-side, and the time is on the season's curve
                unless he has hours of his own. Absent on a card stashed by an older
                build, which is why it is guarded rather than assumed. */}
            {day.nextDuty && (
                <p className={styles.dutyfoot}>
                    {nextOpeningText(day.nextDuty, day.date, "mine").full}
                </p>
            )}
        </section>
    );
}
