"use client";

/**
 * The photographs of everyone who has signed in on THIS PC.
 *
 * The twin of the grid in `resources/shell/login.html`. The two cannot share code — the
 * shell is a `file://` page that paints before any server exists — so they are kept in
 * step by hand, the same arrangement as the wording in `loginShowcase.ts`. Same states,
 * same words, same order: change one, change the other.
 *
 * The roster is a local convenience cache on that PC and never an authority: a card is a
 * shortcut to an address and a keypad, and the sign-in behind it is the ordinary
 * server-side one. A hand-edited roster buys nobody a permission.
 */

import type { ShellRosterEntry } from "@/shared/lib/counter/shellRoster";
import styles from "./login.module.css";

/** First and last initial, for a person with no photograph. */
export function initials(name: string): string {
    const parts = String(name || "").trim().split(/\s+/);
    const out = (parts[0]?.charAt(0) ?? "") + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "");
    return out.toUpperCase() || "·";
}

export function Face({ entry, size }: { entry: ShellRosterEntry; size?: number }) {
    const px = size ?? 52;
    // A plain <img>, not next/image: the source is a file:// path to this PC's own
    // cached copy, which the optimiser can neither fetch nor serve.
    // eslint-disable-next-line @next/next/no-img-element
    const photo = entry.avatarFile ? <img src={entry.avatarFile} alt="" onError={(e) => {
        // A cached face that will not load falls back to initials, never a hole.
        e.currentTarget.replaceWith(document.createTextNode(initials(entry.name)));
    }} /> : null;

    return (
        <div className={styles.pic} style={{ width: px, height: px }}>
            {photo ?? initials(entry.name)}
        </div>
    );
}

export default function FaceGrid({
    roster, editing, onChoose, onForget, onOther, onEdit,
}: {
    roster: ShellRosterEntry[];
    editing: boolean;
    onChoose: (entry: ShellRosterEntry) => void;
    onForget: (entry: ShellRosterEntry) => void;
    onOther: () => void;
    onEdit: () => void;
}) {
    return (
        <>
            <div className={`${styles.grid} ${editing ? styles.editing : ""}`}>
                {roster.map((entry) => (
                    <button key={entry.email} type="button" className={styles.face}
                        onClick={() => onChoose(entry)}>
                        <Face entry={entry} />
                        <p className={styles.who}>{entry.name}</p>
                        {/* Somebody with no PIN still shows — their card asks for the
                            password instead. A card that quietly disappeared would be the
                            most confusing thing on this screen. */}
                        <p className={styles.post}>{entry.title || (entry.hasPin ? "" : "Password")}</p>
                        <span
                            role="button" tabIndex={0} className={styles.drop}
                            aria-label={`Forget ${entry.name} on this PC`}
                            onClick={(e) => { e.stopPropagation(); onForget(entry); }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onForget(entry); }
                            }}
                        >×</span>
                    </button>
                ))}
            </div>
            <div className={styles.rowlinks}>
                <button type="button" className={styles.pinlink} onClick={onOther}>Someone else</button>
                <button type="button" className={styles.pinlink} onClick={onEdit}>
                    {editing ? "Done" : "Edit list"}
                </button>
            </div>
        </>
    );
}
