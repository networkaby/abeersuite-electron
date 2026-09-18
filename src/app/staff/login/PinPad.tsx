"use client";

/**
 * The keypad, once a face has been tapped.
 *
 * The twin of the pad in `resources/shell/login.html` — same six dots, same keys, same
 * words. See `FaceGrid.tsx` for why the two are hand-kept in step rather than shared.
 *
 * It owns only what is typed. Everything else — whether the PIN was right, whether the
 * password has fallen due — is the server's answer, handed back in as `error`/`note`.
 */

import { useCallback, useEffect, useState } from "react";
import type { ShellRosterEntry } from "@/shared/lib/counter/shellRoster";
import { Face } from "./FaceGrid";
import styles from "./login.module.css";

export default function PinPad({
    entry, note, error, busy, onSubmit, onBack, onUsePassword,
}: {
    entry: ShellRosterEntry;
    note: string;
    error: string;
    busy: boolean;
    onSubmit: (pin: string) => void;
    onBack: () => void;
    onUsePassword: () => void;
}) {
    const [typed, setTyped] = useState("");

    const press = useCallback((digit: string) => {
        if (busy || typed.length >= 6) return;
        const next = typed + digit;
        // The sixth digit goes straight out and the dots empty with it, so a refused PIN
        // is already waiting on a clean pad. Deliberately NOT inside a setTyped updater:
        // React runs those during render, and a sign-in started from there sets state on
        // this component mid-render.
        if (next.length === 6) { setTyped(""); onSubmit(next); }
        else setTyped(next);
    }, [busy, typed, onSubmit]);

    // The number row and the numpad both work — a cashier who reaches for the keyboard
    // should not have to go back to the mouse.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key >= "0" && e.key <= "9") { press(e.key); e.preventDefault(); }
            else if (e.key === "Backspace") { setTyped((w) => w.slice(0, -1)); e.preventDefault(); }
            else if (e.key === "Escape") { onBack(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [press, onBack]);

    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "del"];

    return (
        <section className={`${styles.card} ${styles.padcard}`}>
            {/* Keyed so a different person starts the photo chain again. */}
            <Face key={entry.email} entry={entry} size={60} />
            <p className={styles.who}>Welcome back, {entry.name.split(/\s+/)[0]}</p>
            <p className={styles.post}>{busy ? "Signing in…" : note}</p>

            <div className={styles.dots}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <i key={i} className={i < typed.length ? styles.fill : ""} />
                ))}
            </div>

            <div className={styles.keys}>
                {keys.map((label) => (
                    <button
                        key={label} type="button"
                        className={`${styles.key} ${label === "back" || label === "del" ? styles.soft : ""}`}
                        onClick={() => {
                            if (label === "back") onBack();
                            else if (label === "del") setTyped((w) => w.slice(0, -1));
                            else press(label);
                        }}
                    >
                        {label === "back" ? "Back" : label === "del" ? "⌫" : label}
                    </button>
                ))}
            </div>

            {error && <p className={styles.err}>{error}</p>}

            <div className={styles.rowlinks}>
                <button type="button" className={styles.pinlink} onClick={onBack}>Back to photos</button>
                {/* A PIN cannot be changed from here — the route asks for the password
                    first — so this is the way to it. */}
                <button type="button" className={styles.pinlink} onClick={onUsePassword}>Use password</button>
            </div>
        </section>
    );
}
