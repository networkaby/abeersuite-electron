import "server-only";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Sign-out on a till ends the login on THIS till only (owner, 2026-10-13).
 *
 * The login is a stateless JWT, so "signed out" has to be written somewhere the next
 * request can see — otherwise a request still in flight when Sign out cleared the
 * cookie renews it and the till signs itself back in. It used to be
 * `User.tokensValidFrom` in Supabase, which ended every login of that person on every
 * till and the office site as well. Now a till keeps its own mark, in a file beside
 * counter-setup.json: "tokens of user N minted before T are dead here".
 *
 * A file and not a table: it is this machine's business alone, must never sync, and
 * both the proxy and `/api/auth` (separate module copies) read it, so an in-memory
 * map would not do. Read once per change of the file's mtime.
 */

const FILE = "local-sign-outs.json";

type Marks = Record<string, number>;

let cache: { mtimeMs: number; marks: Marks } | null = null;

function filePath(): string | null {
    const dir = process.env.COUNTER_USER_DATA;
    return dir ? path.join(dir, FILE) : null;
}

function readMarks(): Marks {
    const file = filePath();
    if (!file) return {};
    try {
        const { mtimeMs } = fs.statSync(file);
        if (cache && cache.mtimeMs === mtimeMs) return cache.marks;
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
        const marks: Marks = parsed && typeof parsed === "object" ? (parsed as Marks) : {};
        cache = { mtimeMs, marks };
        return marks;
    } catch {
        return {}; // no file yet, or unreadable — nobody has signed out here
    }
}

/** When this person last signed out on this till, or 0. */
export function localSignOutAt(userId: string | number): number {
    const at = readMarks()[String(userId)];
    return typeof at === "number" ? at : 0;
}

/** Record a sign-out on this till. Best-effort: a failed write only means a renewed
 *  cookie from a request already in flight may survive this one sign-out. */
export function markLocalSignOut(userId: string | number, at = Date.now()): void {
    const file = filePath();
    if (!file) return;
    try {
        const marks = { ...readMarks(), [String(userId)]: at };
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(marks));
        fs.renameSync(tmp, file);
        cache = null;
    } catch (err) {
        console.error("[localSignOut] could not record the sign-out:", err);
    }
}
