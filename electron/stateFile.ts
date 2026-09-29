/**
 * The small JSON files this app keeps in userData (which counter this PC is, its
 * installation id, preferences), read and written so a power cut can never leave one
 * half-written — and so a damaged one is never mistaken for a missing one.
 *
 * That difference decides what boot does. "No counter-setup.json" means this PC holds
 * no counter and its replica is emptied; a file cut short mid-write used to read the
 * same way, so a power cut during a save could throw away a till's unsent sales.
 *
 * Writes go to a temp file in the same folder, are flushed to disk, and are renamed over
 * the target — a rename within one folder replaces the file in one step, so a reader
 * sees the old contents or the new, never a mix. Reads say which of three things they
 * found: the value, no file at all, or a file that exists but cannot be used.
 *
 * Node built-ins only, so `tsx` can run it from scripts/check-state-file.ts.
 */

import fs from "fs";
import path from "path";

export type StateRead<T> =
    | { kind: "present"; value: T }
    /** No file at all (ENOENT) — the only answer that means "never written / removed". */
    | { kind: "absent" }
    /** The file exists but is unusable: empty, cut short, the wrong shape, or unreadable. */
    | { kind: "corrupt"; error: string };

/**
 * Read a JSON state file. `validate` turns the parsed value into the caller's type, or
 * returns null when its shape is wrong — which reads as corrupt, not absent.
 */
export function readJsonState<T>(file: string, validate: (raw: unknown) => T | null): StateRead<T> {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
        return { kind: "corrupt", error: `could not read: ${(err as Error).message}` };
    }
    // Strip a byte-order mark — a file hand-edited in Notepad starts with one.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        return { kind: "corrupt", error: `not valid JSON: ${(err as Error).message}` };
    }
    const value = validate(raw);
    return value === null ? { kind: "corrupt", error: "unexpected contents" } : { kind: "present", value };
}

/** Errors a rename on Windows gives while antivirus or an indexer briefly holds the target. */
const TRANSIENT_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 10;
const RENAME_WAIT_MS = 100;

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write `data` as JSON so the file is always either the old contents or the new.
 * Throws when the write cannot be completed; the previous file is then left untouched
 * and no temp file is left behind.
 */
export function writeJsonAtomic(file: string, data: unknown, opts: { mode?: number } = {}): void {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    try {
        const fd = fs.openSync(tmp, "w", opts.mode ?? 0o666);
        try {
            fs.writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        for (let attempt = 1; ; attempt++) {
            try {
                fs.renameSync(tmp, file);
                return;
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code ?? "";
                if (!TRANSIENT_RENAME.has(code) || attempt >= RENAME_ATTEMPTS) throw err;
                sleepSync(RENAME_WAIT_MS);
            }
        }
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
}

/**
 * Move a damaged file aside (kept for support, never deleted) so the next save starts
 * clean and nothing else reads the damaged copy. Returns the new name, or null.
 */
export function setAsideCorrupt(file: string): string | null {
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
        fs.renameSync(file, aside);
        return aside;
    } catch {
        return null;
    }
}
