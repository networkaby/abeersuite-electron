"use client";

/**
 * "Choose your PIN" / "Change your PIN" — the sign-in card asks for it on the way in,
 * password already in hand (`/api/me/counter-pin` asks for it either way, so a till
 * left open is never enough to cut a second key to the account).
 *
 * `onDone` gets the password that was checked.
 */

import { useState } from "react";
import { PIN_LENGTH } from "@/shared/lib/constants/session";
import styles from "./login.module.css";

/** A PIN box takes digits and nothing else — four of them. */
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, PIN_LENGTH);

export default function ChoosePinCard({
    hasPin, counterNumber, password: knownPassword, saveLabel, skipLabel, onDone, onSkip,
}: {
    hasPin: boolean;
    counterNumber: number | null;
    /** Already typed (sign-in). Absent → the card asks for it. */
    password?: string;
    saveLabel: string;
    skipLabel: string;
    onDone: (password: string) => void;
    onSkip: () => void;
}) {
    const [typedPassword, setTypedPassword] = useState("");
    const [pin, setPin] = useState("");
    const [pinAgain, setPinAgain] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const password = knownPassword ?? typedPassword;
    const ready = !!password && pin.length === PIN_LENGTH && pinAgain.length === PIN_LENGTH;

    const save = async () => {
        if (!ready) return;
        if (pin !== pinAgain) { setError("The two PINs are not the same."); return; }
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/me/counter-pin", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pin, password }),
            });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setError(out.error || "Could not save your PIN."); return; }
            onDone(password);
        } catch {
            setError("Could not reach the office. A PIN can only be saved with the line up.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (scope: "counter" | "all") => {
        if (!password) { setError("Type your password first."); return; }
        setBusy(true);
        setError("");
        try {
            const res = await fetch(`/api/me/counter-pin?scope=${scope}`, { method: "DELETE" });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setError(out.error || "Could not remove your PIN."); return; }
            onDone(password);
        } catch {
            setError("Could not reach the office. A PIN can only be removed with the line up.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={styles.card}>
            <h1 className={styles.greet}>{hasPin ? "Change your PIN" : "Choose your PIN"}</h1>
            <p className={styles.clock}>
                Four digits{counterNumber !== null ? `, for counter ${counterNumber} only` : ""}.
                Next time just tap your photo — after a lock, a restart or a colleague.
            </p>

            {knownPassword === undefined && (
                <div className={styles.field}>
                    <label htmlFor="pin-pass">Your password</label>
                    <input
                        id="pin-pass" type="password" autoComplete="current-password" autoFocus
                        value={typedPassword}
                        onChange={(e) => { setTypedPassword(e.target.value); setError(""); }}
                    />
                </div>
            )}

            <div className={styles.field}>
                <label htmlFor="pin">{hasPin ? "New PIN" : "PIN"}</label>
                <input
                    id="pin" type="password" inputMode="numeric" autoComplete="off"
                    placeholder="4 digits" autoFocus={knownPassword !== undefined}
                    value={pin}
                    onChange={(e) => { setPin(digitsOnly(e.target.value)); setError(""); }}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="pin2">Type it again</label>
                <input
                    id="pin2" type="password" inputMode="numeric" autoComplete="off"
                    placeholder="4 digits"
                    value={pinAgain}
                    onChange={(e) => { setPinAgain(digitsOnly(e.target.value)); setError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                />
            </div>

            <button className={styles.go} type="button" disabled={busy || !ready} onClick={() => void save()}>
                {busy ? "Saving…" : saveLabel}
            </button>
            {error && <p className={styles.err}>{error}</p>}

            {/* Removing is the same errand, so it lives on the same card. */}
            {hasPin && (
                <div className={styles.pinrow}>
                    <button type="button" className={styles.pinlink} disabled={busy}
                        onClick={() => void remove("counter")}>
                        Remove from this counter
                    </button>
                    <button type="button" className={styles.pinlink} disabled={busy}
                        onClick={() => void remove("all")}>
                        Remove from all
                    </button>
                </div>
            )}

            <button type="button" className={styles.pinlink} disabled={busy} onClick={onSkip}>
                {skipLabel}
            </button>

            <p className={styles.pinnote}>
                The line must be up to save a PIN. Using it works offline, and your password
                is still asked every few days.
            </p>
        </section>
    );
}
