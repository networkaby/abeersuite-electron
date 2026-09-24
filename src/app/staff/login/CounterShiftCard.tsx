"use client";

import { useEffect, useState } from "react";
import { formatClockTime } from "@/shared/lib/format/formatDate";
import styles from "./login.module.css";

type CounterShift = {
    status:            "OPEN" | "AWAITING_HANDOVER";
    cashierName:       string;
    counterName:       string;
    openedAt:          string;
    handedOverAt:      string | null;
    countedPaise:      string | null;
    expectedCashPaise: string;
    tenders:           { label: string; amountPaise: string }[];
};

const inr = (paise: string) =>
    (Number(paise) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/**
 * "Waiting handover · Rakib · Expected cash ₹12,500 · Card ₹8,200"
 *
 * Whose drawer is on this counter, for the person standing at the lock screen.
 * Every sign-out leaves one behind — a proper handover (counted, then signed out)
 * or a plain sign-out with the shift still running — and whoever signs in next
 * is asked to take it over. This is what they check the drawer against first:
 * seen before signing in, and again in the takeover modal after.
 *
 * Counter PCs only (`/api/counter/shift` answers null anywhere else), and silent
 * on every failure — a panel that cannot load must never stand between a cashier
 * and the keypad.
 */
export default function CounterShiftCard() {
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

    if (!shift) return null;
    const handedOver = shift.status === "AWAITING_HANDOVER";
    // The full name is in the Cashier row; the note only needs to point back at him.
    const firstName = shift.cashierName.split(/\s+/)[0];

    return (
        <section className={styles.duty}>
            <p className={styles.dutyhead}>
                {handedOver ? "Waiting handover" : "Shift open"} · {shift.counterName}
            </p>

            <p className={styles.dutybig}>{inr(shift.expectedCashPaise)}</p>
            <p className={styles.dutysub}>expected cash in the drawer</p>

            <dl className={styles.dutyrows}>
                <div><dt>Cashier</dt><dd>{shift.cashierName}</dd></div>
                {handedOver && shift.handedOverAt
                    ? <div><dt>Handed over at</dt><dd>{formatClockTime(shift.handedOverAt)}</dd></div>
                    : <div><dt>Open since</dt><dd>{formatClockTime(shift.openedAt)}</dd></div>}
                {shift.countedPaise != null && (
                    <div><dt>Counted</dt><dd>{inr(shift.countedPaise)}</dd></div>
                )}
                {shift.tenders.map((t) => (
                    <div key={t.label}><dt>{t.label} collected</dt><dd>{inr(t.amountPaise)}</dd></div>
                ))}
            </dl>

            <p className={styles.dutyfoot}>
                {handedOver
                    ? "Sign in to review the drawer and take it over."
                    : `Signed out without handing over. Sign in to review the drawer and take it over — or ${firstName} signs back in and carries on.`}
                {" "}Accepting makes the drawer yours.
            </p>
        </section>
    );
}
