"use client";

import axios from "axios";
import { localDb, type LocalAnswer } from "@/shared/lib/browser/localDb";
import { userScopedKey } from "@/shared/lib/browser/pollCache";

/**
 * The phone app's saved server answers — one row per screen + person in the
 * shared Dexie database (`answers`), never localStorage.
 *
 * Every phone screen loads the same way (`loadAnswer`):
 *   1. the saved answer shows at once — no blank screen on a weak signal;
 *   2. if it is younger than the screen's `freshMs`, nothing is asked at all;
 *   3. otherwise the server is asked — with `?since=<the answer's computedAt>`
 *      where the endpoint supports it, so a book nobody has posted to since
 *      answers `{ unchanged: true }` from one indexed probe instead of the
 *      whole recompute and the whole payload. That, and step 2, is where the
 *      egress goes down.
 *
 * Where IndexedDB is unavailable (`localDb()` null) it simply asks every time.
 */

/** Saved answers kept on one device, oldest dropped first. */
const MAX_ANSWERS = 60;

const PREFIX = "m:";

/** The answers table's key for a screen — always scoped to the signed-in person. */
export function mobileKey(name: string, userId: string | number): string {
    return userScopedKey(`${PREFIX}${name}`, userId);
}

/** "Could not reach the server. Showing figures from 10:42." — what a screen says
 *  when the saved answer is all it has. */
export function offlineNote(message: string, savedAt: number | null): string {
    if (savedAt == null) return message;
    const at = new Date(savedAt);
    const sameDay = at.toDateString() === new Date().toDateString();
    const when = at.toLocaleString("en-IN", sameDay
        ? { hour: "numeric", minute: "2-digit" }
        : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return `${message} Showing figures from ${when}.`;
}

/** What a since-aware endpoint answers when nothing moved. */
type Unchanged = { unchanged: true; computedAt: string };

let legacyCleared = false;

/** The first build kept answers in localStorage under `m:` — drop them, once. */
function clearLegacy(): void {
    if (legacyCleared) return;
    legacyCleared = true;
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}last-ledger:`)) localStorage.removeItem(k);
        }
    } catch { /* storage blocked — nothing was saved there either */ }
}

async function readAnswer(key: string): Promise<LocalAnswer | null> {
    clearLegacy();
    try {
        return (await localDb()?.answers.get(key)) ?? null;
    } catch {
        return null;
    }
}

async function saveAnswer(key: string, data: unknown, computedAt: string): Promise<void> {
    const db = localDb();
    if (!db) return;
    try {
        await db.answers.put({ key, data, computedAt, savedAt: Date.now() });
        const count = await db.answers.count();
        if (count > MAX_ANSWERS) {
            const oldest = await db.answers.orderBy("savedAt").limit(count - MAX_ANSWERS).primaryKeys();
            await db.answers.bulkDelete(oldest);
        }
    } catch { /* quota / blocked — this screen just asks again next time */ }
}

/** Forget saved answers whose key starts with `m:<prefix>` — after a payment, the
 *  party and the receivable / payable lists it moved must not be trusted. */
export async function dropAnswers(...prefixes: string[]): Promise<void> {
    const db = localDb();
    if (!db) return;
    try {
        await Promise.all(prefixes.map((p) => db.answers.where("key").startsWith(`${PREFIX}${p}`).delete()));
    } catch { /* best effort — the freshness window bounds what survives */ }
}

export type AnswerOptions = {
    /** Show a saved answer this young without asking. */
    freshMs: number;
    /** The endpoint understands `?since=` and may answer `{ unchanged: true }`. */
    since?: boolean;
    /** Ask whatever the age (the ↻ button). */
    force?: boolean;
};

/**
 * Show the saved answer for `key` (if any), then ask the server unless it is
 * fresh. `show` is called with each answer as it becomes known, with the time it
 * was saved (for "as of 10:42"). Throws when the server could not be reached —
 * after the saved answer, if there was one, has already been shown.
 */
export async function loadAnswer<T>(
    key: string,
    url: string,
    opts: AnswerOptions,
    show: (data: T, savedAt: number) => void,
): Promise<void> {
    const saved = await readAnswer(key);
    if (saved) show(saved.data as T, saved.savedAt);
    if (saved && !opts.force && Date.now() - saved.savedAt < opts.freshMs) return;

    const ask = opts.since && saved
        ? `${url}${url.includes("?") ? "&" : "?"}since=${encodeURIComponent(saved.computedAt)}`
        : url;
    const { data } = await axios.get<(T & { computedAt?: string }) | Unchanged>(ask);

    if ((data as Unchanged).unchanged && saved) {
        // Nothing posted since — the saved answer stands; only its clock moves.
        await saveAnswer(key, saved.data, (data as Unchanged).computedAt);
        show(saved.data as T, Date.now());
        return;
    }
    const fresh = data as T & { computedAt?: string };
    await saveAnswer(key, fresh, fresh.computedAt ?? new Date().toISOString());
    show(fresh, Date.now());
}
