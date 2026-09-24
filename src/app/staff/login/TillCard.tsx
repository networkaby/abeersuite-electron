"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatClockTime, formatHhMmFriendly, weekdayAndDate, weekdayName } from "@/shared/lib/format/formatDate";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { myDayStore } from "@/shared/lib/hr/myDay";
import { nextOpeningText } from "@/shared/lib/hr/nextOpeningText";
import styles from "./login.module.css";

type CounterShift = {
    status:            "OPEN" | "AWAITING_HANDOVER";
    cashierName:       string;
    counterName:       string;
    openedAt:          string;
    handedOverAt:      string | null;
    countedPaise:      string | null;
    expectedCashPaise: string;
    /** Every method the counter takes, cash first, ₹0 rows included. */
    tenders:           { label: string; amountPaise: string }[];
};

const inr = (paise: string) =>
    (Number(paise) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/**
 * The till's own card on the lock screen — one card, three things the person
 * standing at the counter wants to know, in the order they matter:
 *
 *   1. NEXT DUTY — when he is next expected, said big. The most useful line on
 *      the screen for the man on his way out, so it is the hero, not a footnote.
 *   2. TODAY — the day he just finished: worked against duty, away, late, the
 *      verdict, and where the month stands after the make-up.
 *   3. THE DRAWER — whose shift is on this counter, the cash expected in it, and
 *      every payment method the counter takes with what each collected. Zero
 *      rows stay, so a quiet evening still shows UPI and Card as methods.
 *
 * Two sources, each on its own rule. The day comes from `sessionStorage`, put
 * there by the sign-out and read exactly once — it shows on the LOGIN screen
 * rather than a dialog because the common way a till session ends is the idle
 * auto-logout, with nobody there to read a dialog. The drawer is fetched from
 * `/api/counter/shift`, counter PCs only, silent on every failure: a panel that
 * cannot load must never stand between a cashier and the keypad.
 *
 * Renders nothing when neither is there, so an ordinary locked till is exactly
 * the shell's screen and the cold-start handover does not jump.
 */
export default function TillCard() {
    const day = useSyncExternalStore(
        myDayStore.subscribe, myDayStore.getSnapshot, myDayStore.getServerSnapshot,
    );
    const [shift, setShift] = useState<CounterShift | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/counter/shift");
                if (!res.ok) return;
                const out = await res.json() as CounterShift | null;
                if (alive && out) setShift(out);
            } catch {
                /* no panel, never a blocked sign-in */
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!day && !shift) return null;

    const counterName = day?.counterName ?? shift?.counterName ?? "";
    const next = day?.nextDuty;
    const nextWords = next && day ? nextOpeningText(next, day.date, "mine") : null;
    // "Tomorrow" on its own is the whole answer; a day further out is named in full.
    const nextDay = next && day
        ? (weekdayName(next.iso, day.date) === "Tomorrow" ? "Tomorrow" : weekdayAndDate(next.iso))
        : "";

    const verdict = !day ? "" :
        day.grade === "PRESENT"  ? "Full day"
      : day.grade === "HALF_DAY" ? "Half day"
      :                            "Not counted";

    const filled = day && day.dutyMinutes > 0 ? Math.min(100, (day.workedMinutes / day.dutyMinutes) * 100) : null;
    const m = day?.month;
    const monthLine = !m ? "" :
        m.surplusMinutes === 0 && m.shortfallMinutes === 0
            ? "This month: on duty, nothing over and nothing owed."
            : m.owedMinutes > 0
                ? `This month: ${formatWorked(m.surplusMinutes)} overtime against ${formatWorked(m.shortfallMinutes)} short — ${formatWorked(m.owedMinutes)} still to make up.`
                : m.payableMinutes > 0
                    ? `This month: ${formatWorked(m.madeUpMinutes)} made up, ${formatWorked(m.payableMinutes)} overtime payable.`
                    : "This month: shortfall fully made up, nothing extra yet.";

    const handedOver = shift?.status === "AWAITING_HANDOVER";
    const firstName = shift?.cashierName.split(/\s+/)[0] ?? "";

    return (
        <section className={styles.duty}>
            <p className={styles.dutyhead}>
                <span>{counterName || "This counter"}</span>
                {day && <span>{weekdayAndDate(day.date)}</span>}
            </p>

            {/* ── 1. Next duty ─────────────────────────────────────────────── */}
            {next && nextWords && (
                <div className={styles.nexthero}>
                    <p className={styles.nextlabel}>
                        Next duty
                        {nextWords.closed && <em>{nextWords.closed.replace(/\.$/, "")}</em>}
                    </p>
                    <p className={styles.nextday}>{nextDay}</p>
                    <p className={styles.nexttime}>{formatHhMmFriendly(next.startHhMm)}</p>
                </div>
            )}

            {/* ── 2. Today ────────────────────────────────────────────────── */}
            {day && (
                <div className={styles.tillblock}>
                    <p className={styles.tilllabel}>
                        Today
                        {day.firstInAt && <span>in at {formatClockTime(day.firstInAt)}</span>}
                    </p>
                    <p className={styles.dutybig}>
                        {formatWorked(day.workedMinutes)}
                        <small> of {formatWorked(day.dutyMinutes)}</small>
                    </p>
                    {filled !== null && (
                        <div className={styles.dutybar}><i style={{ width: `${filled}%` }} /></div>
                    )}
                    <div className={styles.stats}>
                        <div className={day.grade === "PRESENT" ? styles.statgood : styles.statwarn}>
                            <b>{verdict}</b>
                            <span>{day.officeMarked ? "office marked" : "verdict"}</span>
                        </div>
                        {day.overtimeMinutes > 0 && <div><b>{formatWorked(day.overtimeMinutes)}</b><span>overtime</span></div>}
                        {day.shortMinutes > 0 && <div><b>{formatWorked(day.shortMinutes)}</b><span>away</span></div>}
                        {day.lateMinutes ? <div><b>{formatWorked(day.lateMinutes)}</b><span>late</span></div> : null}
                    </div>
                    <p className={styles.dutymonth}>
                        {monthLine}
                        {m && m.weeklyOffMinutes > 0 ? ` Includes ${formatWorked(m.weeklyOffMinutes)} on your day off.` : ""}
                    </p>
                </div>
            )}

            {/* ── 3. The drawer ───────────────────────────────────────────── */}
            {shift && (
                <div className={styles.tillblock}>
                    <p className={styles.tilllabel}>
                        {handedOver ? "Drawer handed over" : "Drawer open"}
                        <span>
                            {handedOver && shift.handedOverAt
                                ? `${firstName} · ${formatClockTime(shift.handedOverAt)}`
                                : `${firstName} · since ${formatClockTime(shift.openedAt)}`}
                        </span>
                    </p>
                    <p className={styles.dutybig}>
                        {inr(shift.expectedCashPaise)}
                        <small> expected cash</small>
                    </p>
                    {shift.countedPaise != null && (
                        <p className={styles.dutysub}>{firstName} counted {inr(shift.countedPaise)}</p>
                    )}
                    <dl className={styles.tenders}>
                        {shift.tenders.map((t) => (
                            <div key={t.label} className={Number(t.amountPaise) === 0 ? styles.nil : undefined}>
                                <dt>{t.label}</dt><dd>{inr(t.amountPaise)}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className={styles.dutyfoot}>
                        {handedOver
                            ? "Sign in to review the drawer and take it over — it becomes yours."
                            : `${firstName} signed out without handing over. Sign in to take the drawer over, or ${firstName} signs back in and carries on.`}
                    </p>
                </div>
            )}
        </section>
    );
}
