import "server-only";
import * as fs from "node:fs";
import * as path from "node:path";
import { markLocalSignOut } from "@/shared/lib/auth/localSignOut";

/**
 * A counter's soft lock (owner, 2026-10-13: "soft logout is just a cover, so login
 * back takes less time").
 *
 * Locking covers the screen and keeps the login alive underneath; the person's
 * 4-digit PIN lifts the cover. The lock is written HERE, on the till, rather than
 * kept in the browser, so a refresh, a new window or an app restart comes back
 * covered — a lock that F5 removes is no lock.
 *
 * A file beside `local-sign-outs.json`, for the same reasons (`localSignOut.ts`):
 * this machine's business alone, never synced, and read by route handlers that may
 * be separate module copies. One person at a time — a till has one login.
 *
 * `userId: ""` is the BOOT lock: the desktop shell writes it on a start that finds a
 * login still alive (electron/main.ts), so a till never opens straight onto the last
 * person's screen. Whoever's login asks first adopts it (`/api/counter-lock`).
 */

const FILE = "local-lock.json";

export type LocalLock = {
    userId: string;
    /** The person's last real input before the lock — the 3-day idle clock runs
     *  from here, not from the lock itself. */
    lockedAt: number;
    /** Wrong PINs / passwords in a row. */
    failures: number;
};

function filePath(): string | null {
    const dir = process.env.COUNTER_USER_DATA;
    return dir ? path.join(dir, FILE) : null;
}

/** The lock on this till, or null. */
export function readLocalLock(): LocalLock | null {
    const file = filePath();
    if (!file) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<LocalLock> | null;
        if (!parsed || typeof parsed.userId !== "string" || typeof parsed.lockedAt !== "number") return null;
        return { userId: parsed.userId, lockedAt: parsed.lockedAt, failures: Number(parsed.failures) || 0 };
    } catch {
        return null;   // no file — nobody has locked this till
    }
}

/** Write (or with null, lift) the lock. Throws on a failed write: a lock that did
 *  not stick must not be reported as locked. */
export function writeLocalLock(lock: LocalLock | null): void {
    const file = filePath();
    if (!file) return;
    if (!lock) {
        fs.rmSync(file, { force: true });
        return;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lock));
    fs.renameSync(tmp, file);
}

/** Lift the lock as part of a full sign-out. Best-effort — the sign-out matters more. */
export function clearLocalLock(): void {
    try { writeLocalLock(null); } catch (err) { console.error("[localLock] could not clear the lock:", err); }
}

/**
 * Somebody has just signed in on this till, by password or PIN — the cover goes. A
 * lock that belonged to somebody else ends that person's login here too: the till has
 * one login, and the new cookie has already replaced theirs.
 */
export function takeOverLocalLock(userId: string): void {
    const lock = readLocalLock();
    if (!lock) return;
    if (lock.userId && lock.userId !== userId) markLocalSignOut(lock.userId);
    clearLocalLock();
}
