/**
 * The ONE place that turns counter status into the words the shell shows.
 *
 * Every surface that reports where this machine stands — the badge, the Electron
 * window title, a page-level "showing a local copy" banner — derives its text here.
 * They used to each decide for themselves, with three different vocabularies and
 * three different rules, and so contradicted each other in ordinary states: the
 * badge said "Live" while the title said "Online • Local", because one tested
 * `preference !== "live" && replicaReady` and the other tested `replicaReady`
 * alone. A single helper makes that class of bug unrepresentable.
 *
 * ── Two axes, never mixed ────────────────────────────────────────────────────
 * WORD says which database is answering. COLOUR says whether Supabase is
 * reachable. They are independent, and keeping them independent is the whole
 * point: the old badge printed "Local" for both "healthy replica, reading fast"
 * and "server unreachable", leaving colour to carry a distinction the word was
 * actively contradicting.
 *
 *   Local    — this machine's replica, BY CHOICE (READ_MODE/WRITE_MODE=local).
 *   Live     — Supabase.
 *   Offline  — the dial says `live`, but Supabase cannot be reached, so we are
 *              falling back to the replica. A failure, not a mode.
 *
 * Green on "Local" therefore means something worth saying: the replica is being
 * kept in step, so what you are reading is trustworthy. Red on "Local" is the
 * same source drifting — same word, because the source really is the same, and
 * the colour is what changed.
 *
 * ── Why `local` is never "Offline" ───────────────────────────────────────────
 * A counter deliberately set to read and write locally is doing exactly what it
 * was configured to do whether or not the internet is up. Calling that "Offline"
 * would report a failure that has not happened. Its colour still goes red,
 * because its work is not leaving the machine — that part IS a problem.
 */

/** What the shell prints for a read or a write. See the header for the meanings. */
export type StatusWord = "Local" | "Live" | "Offline";

/** Whether Supabase is reachable. Not "is anything wrong" — see `Offline`. */
export type StatusTone = "ok" | "down";

export type StatusField = { word: StatusWord; tone: StatusTone };

export type ShellStatus = {
    read: StatusField;
    write: StatusField;
    /** True when Supabase is unreachable — the single fact behind both tones. */
    offline: boolean;
};

/** The subset of `/api/counter/status` these labels need. */
export type StatusInput = {
    mode: "LIVE" | "LOCAL";
    preference: string;
    writePreference: string;
    replicaReady: boolean;
    cloudReachable?: boolean;
};

/**
 * Is Supabase unreachable right now?
 *
 * Two independent witnesses, because neither covers the other. `mode` is driven by
 * a live query actually failing, which cannot happen under WRITE_MODE=local where
 * nothing on the request path touches Supabase at all; `cloudReachable` comes from
 * the outbox flusher, the one thing still talking to it on a timer. The old title
 * bar consulted only the first and so stayed "Online" through a total outage.
 */
export function isOffline(s: StatusInput): boolean {
    return s.mode === "LOCAL" || s.cloudReachable === false;
}

export function shellStatus(s: StatusInput): ShellStatus {
    const offline = isOffline(s);
    const tone: StatusTone = offline ? "down" : "ok";

    // Reads only actually reach the replica once it has proved itself ready — an
    // unready replica returns fewer rows rather than an error, so `READ_MODE=local`
    // alone is not enough to claim "Local". Until then reads are served live, and
    // the word must say so.
    const readsLocal = s.preference === "local" && s.replicaReady;

    return {
        read: { word: readsLocal ? "Local" : offline ? "Offline" : "Live", tone },
        write: { word: s.writePreference === "local" ? "Local" : offline ? "Offline" : "Live", tone },
        offline,
    };
}
