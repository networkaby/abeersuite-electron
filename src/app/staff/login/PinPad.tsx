"use client";

/**
 * The keypad on the counter's lock cover (`CounterLock.tsx`).
 *
 * Only draws: the digits typed so far belong to the lock, which also owns the
 * keyboard — it has to swallow every key while the till is covered, so the keypad
 * cannot have a listener of its own. Whether the PIN was right is the server's
 * answer, handed back in as `error`.
 */

import type { ReactNode } from "react";
import type { ShellRosterEntry } from "@/shared/lib/counter/shellRoster";
import { Face } from "./FaceGrid";
import styles from "./login.module.css";

export default function PinPad({
    entry, length, typed, note, error, onPress, onDelete, header, children,
}: {
    /** Above the photo — the greeting, the date and the shop's next opening. */
    header?: ReactNode;
    entry: ShellRosterEntry;
    length: number;
    typed: string;
    note: string;
    error: string;
    onPress: (digit: string) => void;
    onDelete: () => void;
    /** The links under the keys. */
    children?: ReactNode;
}) {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

    return (
        <section className={`${styles.card} ${styles.padcard}`}>
            {header}
            {/* Keyed so a different person starts the photo chain again. */}
            <Face key={entry.email} entry={entry} size={60} />
            <p className={styles.who}>{entry.name}</p>
            <p className={styles.post}>{note}</p>

            <div className={styles.dots}>
                {Array.from({ length }, (_, i) => (
                    <i key={i} className={i < typed.length ? styles.fill : ""} />
                ))}
            </div>

            <div className={styles.keys}>
                {keys.map((label) => label === "" ? <span key="blank" /> : (
                    <button
                        key={label} type="button"
                        className={`${styles.key} ${label === "del" ? styles.soft : ""}`}
                        onClick={() => (label === "del" ? onDelete() : onPress(label))}
                    >
                        {label === "del" ? "⌫" : label}
                    </button>
                ))}
            </div>

            {error && <p className={styles.err}>{error}</p>}
            {children}
        </section>
    );
}
