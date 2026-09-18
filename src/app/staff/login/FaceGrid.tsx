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

import { useEffect, useState } from "react";
import type { ShellRosterEntry } from "@/shared/lib/counter/shellRoster";
import styles from "./login.module.css";

/** First and last initial, for a person with no photograph. */
export function initials(name: string): string {
    const parts = String(name || "").trim().split(/\s+/);
    const out = (parts[0]?.charAt(0) ?? "") + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "");
    return out.toUpperCase() || "·";
}

/**
 * This PC's cached copy at once, the live one over it when it arrives.
 *
 * Order matters and it is not the obvious one. Asking the web first is "correct" and
 * reads as broken: the cashier watches initials for as long as the photograph takes,
 * which on a shop line is long enough to look like a fault — the owner said exactly
 * that, having mistaken the wait for a missing photo. The cached copy is on disk and
 * paints instantly, so the card is never empty; the live one is fetched beside it and
 * takes over the moment it decodes, so a photograph changed in the office still shows
 * here today rather than at the next sign-in.
 *
 * With no cache there is nothing to show but initials until the web answers, and with
 * no line the cached copy simply stays. Nothing ever waits on the network.
 */
export function Face({ entry, size }: { entry: ShellRosterEntry; size?: number }) {
    const px = size ?? 52;
    const [live, setLive] = useState(false);

    useEffect(() => {
        if (!entry.avatarUrl) return;
        let cancelled = false;
        const probe = new Image();
        probe.onload = () => { if (!cancelled) setLive(true); };
        probe.src = entry.avatarUrl;
        return () => { cancelled = true; };
    }, [entry.avatarUrl]);

    const src = live ? entry.avatarUrl : (entry.avatarFile ?? entry.avatarUrl);

    return (
        <div className={styles.pic} style={{ width: px, height: px }}>
            {src
                // A plain <img>, not next/image: one source is a data: URL of this PC's
                // own cache, which the optimiser can neither fetch nor serve.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={src} alt="" />
                : initials(entry.name)}
        </div>
    );
}

/**
 * What somebody is, under their name: every seat they hold and where it sits.
 *
 * A person can hold more than one Position — a Branch Manager who also sits on the
 * Executive Council — and both print, senior first, because "which one is he here?"
 * is what a face on a till has to answer. The scope is the branch, or the words this
 * business uses for a seat with no branch (see positionScope.ts).
 *
 * A typed `title` wins outright: somebody who has filled one in means it.
 */
export function Seats({ entry }: { entry: ShellRosterEntry }) {
    if (entry.title) return <p className={styles.post}>{entry.title}</p>;

    const seats = entry.seats ?? [];
    // No seat and no PIN: say what tapping the card will ask for, rather than nothing.
    if (seats.length === 0) {
        return <p className={styles.post}>{entry.hasPin ? "" : "Password"}</p>;
    }

    return (
        <>
            {seats.map((seat) => (
                <div key={seat.title + seat.scope}>
                    <p className={styles.post}>{seat.title}</p>
                    <p className={styles.scope}>{seat.scope}</p>
                </div>
            ))}
        </>
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
                        <Seats entry={entry} />
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
