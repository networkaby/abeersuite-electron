import "server-only";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AI_RATE_LIMIT_REST_MS } from "@/shared/lib/constants/ai";

/**
 * Which AI keys are locked out today (owner, 2026-10-19): a key that fails twice
 * in a row is skipped for the rest of the day (India time); one success resets
 * its count. Kept in a file so a restart remembers it — beside counter-setup.json
 * on a till (COUNTER_USER_DATA), the OS temp folder elsewhere (a fresh Vercel
 * instance starts clean, which only costs two quick refused calls). Holds .env
 * key NAMES and counts only — never a key value.
 *
 * A 429 is the free tier's per-minute limit, not a broken key: it only rests the
 * key for AI_RATE_LIMIT_REST_MS (in memory — a restart simply tries it again).
 * Last-use times (also in memory) let callers take free keys in turn.
 */

const FILE = "ai-key-lockouts.json";
const LOCK_AFTER = 2;

type State = { day: string; fails: Record<string, number> };

const indiaDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const filePath = () => path.join(process.env.COUNTER_USER_DATA || os.tmpdir(), FILE);

let memory: State | null = null;
const restUntil: Record<string, number> = {};
const lastUsed: Record<string, number> = {};

function read(): State {
    const today = indiaDay();
    if (memory?.day === today) return memory;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath(), "utf-8")) as State;
        memory = parsed?.day === today && parsed.fails && typeof parsed.fails === "object" ? parsed : { day: today, fails: {} };
    } catch {
        memory = { day: today, fails: {} }; // no file yet, or unreadable
    }
    return memory;
}

function write(state: State): void {
    memory = state;
    try {
        const file = filePath();
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
        fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
        console.warn("[aiKeyLockout] could not save the lockout file:", err instanceof Error ? err.message : err);
    }
}

/** Failed LOCK_AFTER times in a row today, or resting after a 429. */
export function isLockedOut(keyName: string): boolean {
    return (read().fails[keyName] ?? 0) >= LOCK_AFTER || (restUntil[keyName] ?? 0) > Date.now();
}

/** Mark a key as taken now (before the call, so parallel calls see it). */
export function noteKeyUse(keyName: string): void {
    lastUsed[keyName] = Date.now();
}

/** When the key was last taken (0 = not yet since start). */
export const keyLastUsed = (keyName: string) => lastUsed[keyName] ?? 0;

export function noteKeyFailure(keyName: string, opts: { rateLimited?: boolean } = {}): void {
    if (opts.rateLimited) {
        restUntil[keyName] = Date.now() + AI_RATE_LIMIT_REST_MS;
        return; // not a strike towards the day lockout
    }
    const s = read();
    write({ ...s, fails: { ...s.fails, [keyName]: (s.fails[keyName] ?? 0) + 1 } });
}

/** A success clears the run of failures. Writes only when there was one. */
export function noteKeySuccess(keyName: string): void {
    const s = read();
    if (!s.fails[keyName]) return;
    const fails = { ...s.fails };
    delete fails[keyName];
    write({ ...s, fails });
}
