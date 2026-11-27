"use client";

/**
 * "Choose your PIN" / "Change your PIN" — the sign-in card asks for it on the way in,
 * password already in hand (the desktop app has the server check it either way, so a
 * till left open is never enough to cut a second key to the account). The PIN is kept
 * on this PC only (electron/pinVault.ts), never in a database.
 *
 * `onDone` gets the password that was checked.
 */

import { useState } from "react";
import { PIN_LENGTH } from "@/shared/lib/constants/session";
import styles from "./login.module.css";

/** A PIN box takes digits and nothing else — four of them. */
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, PIN_LENGTH);

export default function ChoosePinCard({
    email, hasPin, counterNumber, password: knownPassword, saveLabel, skipLabel, onDone, onSkip,
}: {
    email: string;
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
            const out = await window.electronAPI?.pin?.set({ pin, password });
            if (!out) { setError("A PIN can only be set in the counter app."); return; }
            if (!out.ok) { setError(out.error); return; }
            onDone(password);
        } catch {
            setError("Could not save your PIN.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        setError("");
        try {
            await window.electronAPI?.pin?.remove(email);
            onDone(password);
        } catch {
            setError("Could not remove your PIN.");
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
                        onClick={() => void remove()}>
                        Remove from this counter
                    </button>
                </div>
            )}

            <button type="button" className={styles.pinlink} disabled={busy} onClick={onSkip}>
                {skipLabel}
            </button>

            <p className={styles.pinnote}>
                Kept on this counter only. Works offline; your password is still asked
                every 10 days, or after 3 days unused.
            </p>
        </section>
    );
}
