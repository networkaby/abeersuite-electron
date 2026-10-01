/**
 * Brings a crashed helper process back, and says so in the window title.
 *
 * The sync worker, the hardware bridge and the Next server are child processes of this
 * app, and until 2026-10-01 none of them came back after a crash: a counter whose
 * printer bridge died stopped printing until somebody restarted the whole app, and one
 * whose sync worker died quietly stopped receiving the office's changes.
 *
 * Deliberately small:
 *   - the CALLER decides what is a crash — never an exit it asked for (each manager
 *     clears its handle before stopping a child, so its `exit` handler can tell), and
 *     never an exit that says "do not retry" (the sync worker's exit 2: no config);
 *   - restarts back off, 2 s doubling to 60 s, so a helper that dies at once is not
 *     restarted in a tight loop;
 *   - the 5th crash inside 10 minutes leaves it down and says so, rather than hide a
 *     fault a restart is not fixing behind a loop that buries the one log line
 *     explaining it.
 *
 * The note shows in the window title (main.ts buildFullTitle), the one place every
 * screen already has: "Printer bridge restarting…", then nothing once it is back, or
 * "Printer bridge stopped — restart the app".
 */

const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 10 * 60 * 1000;

// ── Notes for the window title ───────────────────────────────────────────────

const notes = new Map<string, string>();
let onNotesChanged: (() => void) | null = null;

/** Sets (or, with null, clears) one helper's note. */
export function setHelperNote(key: string, note: string | null): void {
    if (note) notes.set(key, note);
    else notes.delete(key);
    onNotesChanged?.();
}

export function helperNotes(): string[] {
    return [...notes.values()];
}

/** main.ts: re-title the window whenever a note changes. */
export function onHelperNotesChanged(fn: () => void): void {
    onNotesChanged = fn;
}

// ── Restarts ─────────────────────────────────────────────────────────────────

export class HelperSupervisor {
    private crashes: number[] = [];
    private timer: NodeJS.Timeout | null = null;

    /** `key` names the note; `label` is what the cashier reads ("Printer bridge"). */
    constructor(private readonly key: string, private readonly label: string) {}

    /**
     * A start or stop the app asked for: no restart may fire after it, the crash count
     * starts clean, and the note goes.
     */
    reset(): void {
        this.cancel();
        this.crashes = [];
        setHelperNote(this.key, null);
    }

    private cancel(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    /** The helper exited without being asked. Runs `restart` after the backoff, or gives up. */
    crashed(restart: () => void): void {
        const now = Date.now();
        this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
        this.crashes.push(now);
        if (this.crashes.length >= MAX_CRASHES) {
            console.error(`[Supervisor] ${this.label} crashed ${MAX_CRASHES} times in 10 minutes — leaving it stopped.`);
            setHelperNote(this.key, `${this.label} stopped — restart the app`);
            return;
        }
        const delay = Math.min(FIRST_DELAY_MS * 2 ** (this.crashes.length - 1), MAX_DELAY_MS);
        console.warn(`[Supervisor] ${this.label} exited unexpectedly — restarting in ${delay / 1000}s.`);
        setHelperNote(this.key, `${this.label} restarting…`);
        this.cancel();
        this.timer = setTimeout(() => {
            this.timer = null;
            setHelperNote(this.key, null);
            restart();
        }, delay);
    }
}
