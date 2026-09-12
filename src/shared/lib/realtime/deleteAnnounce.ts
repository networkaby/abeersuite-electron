/**
 * Tell every counter's sync worker WHICH tables just lost rows on the office.
 *
 * ── Why deletes need their own announcement ──────────────────────────────────
 * A counter replica pulls by watermark: "rows whose `updatedAt` moved since my cursor".
 * A deleted row has no `updatedAt` left to move, so no pull can ever report it. The only
 * thing that removes it from a replica is the worker's reconcile pass (sync-engine/
 * sync-once.js, pass 3), which re-proves each table against the office at most once an
 * hour, a dozen tables per cycle. Found live on 2026-09-12: every coupon deleted on the
 * web office, all eight still on Counter 94 half an hour later.
 *
 * The browser's own change signal (`appChannel.ts`) cannot carry this: it derives topics
 * from a URL and does not know a table from a delete. Prisma does. `wrapLive` in
 * `prismaClient.ts` calls `noteDeleted(model)` after every successful `delete` /
 * `deleteMany` that reached Supabase — the one choke point, since a counter is refused
 * deletes outright (`createLocal`) and every office write goes through that wrapper.
 *
 * ── What travels ─────────────────────────────────────────────────────────────
 * `{ topics: [], at, deleted: ["Coupon"] }` on the same channel as every other signal.
 * Model names only — never a key, never a row. Browser tabs ignore it (their `notify`
 * drops a signal with no topics, and the URL-derived signal already refreshed them),
 * so it costs no second refetch anywhere; the worker (`sync-engine/lib/signal.js`)
 * reads `deleted` and reconciles exactly those tables, plus their cascade children, on
 * the cycle it wakes.
 *
 * Still a HINT. A delete made by raw SQL, a seed or a script announces nothing, and a
 * lost broadcast is not retried — the hourly reconcile stays the safety net. What this
 * changes is the ordinary case: a delete on the office now leaves the counter in about
 * a second instead of within the hour.
 *
 * ── Serverless ──────────────────────────────────────────────────────────────
 * Deletes are coalesced for a short window so one action that removes a parent and
 * its lines announces once. On Vercel the function may be frozen the moment the
 * response goes out, so the pending publish is handed to `after()` when a request scope
 * exists; anywhere else (a counter's Electron server, a script) the timer runs as is.
 */
import { after } from "next/server";
import { publishChangeServer } from "./serverPublish";

const COALESCE_MS = 300;

let pending: Set<string> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let release: (() => void) | null = null;

function flush() {
    flushTimer = null;
    const deleted = pending ? [...pending] : [];
    pending = null;
    const done = release;
    release = null;
    inFlight = null;
    if (deleted.length === 0) { done?.(); return; }
    void publishChangeServer([], { deleted }).finally(() => done?.());
}

/** Record that rows of `model` were hard-deleted on the source. Never throws. */
export function noteDeleted(model: string | undefined): void {
    if (!model) return;
    try {
        pending ??= new Set<string>();
        pending.add(model);
        if (flushTimer) return;
        flushTimer = setTimeout(flush, COALESCE_MS);
        inFlight = new Promise<void>((resolve) => { release = resolve; });
        // Keep a serverless function alive until the announcement has gone out. Throws
        // outside a request scope (a script, a background job) — then the plain timer
        // is enough, because that process is not about to be frozen.
        try { after(inFlight); } catch { /* not in a request — timer suffices */ }
    } catch { /* announcing must never break the delete it rode in on */ }
}
