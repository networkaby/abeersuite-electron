"use strict";

/**
 * The long-running sync worker.
 *
 * Deliberately thin: it is a scheduler around `sync-once.js`, which stays runnable
 * on its own. That separation is what let the engine be tested against a real
 * replica rather than only in theory, and it means a failing cycle can be reproduced
 * by hand with the exact same code path.
 *
 * Each cycle runs as a CHILD PROCESS. A sync touches every table and holds two
 * database connections; running it in-process for weeks means one leak, one wedged
 * connection, or one unhandled rejection takes the service down permanently. A child
 * that dies is just a failed cycle, and the next tick starts clean.
 *
 * Four things make a cycle happen:
 *   - a change signal from the app (fast path, ~1s)
 *   - the app's own "pull these models now" over the replica (lib/localSignal.js):
 *     a TARGETED cycle, run at once, for a write the app relayed to the office and
 *     is holding the response of until this replica has the rows
 *   - the interval (the safety net, because a signal is only ever a hint: writes
 *     from scripts, seeds and the GitHub-Actions restore emit nothing at all)
 *   - startup
 */

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const signal = require("./lib/signal");
const localSignal = require("./lib/localSignal");

const { configPath } = require("./lib/configPath");
const CONFIG = configPath();

/**
 * The safety net, not the mechanism. Long on purpose: boot and every Realtime signal
 * sync regardless of this, so it only has to catch writes with no browser behind them
 * (scripts, seeds, a restore) and any signal that never arrived.
 *
 * Tune it HERE. Deliberately a constant and not a config key: `electron/syncManager.ts`
 * rewrites the worker's config.json on every boot, so a value put there would be erased
 * on the next restart and look like the setting was ignored.
 */
const INTERVAL_MINUTES = 10;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

/** Backoff after a failed cycle, so a broken source is not hammered. */
const RETRY_MS = 60 * 1000;

/** A cycle that has not finished by now is stuck; kill it and let the next one try. */
const CYCLE_TIMEOUT_MS = 15 * 60 * 1000;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Tell the desktop app something it acts on, over the IPC channel it opened
 * (electron/syncManager.ts). Three messages:
 *
 *   { type: "applied", rows, models }  a cycle committed rows; screens re-read now
 *   { type: "drift" }                  schema drift, sync halted until a new build
 *   { type: "cycle-ok" }               a cycle passed, so any drift is over
 *
 * They used to be fished out of this process's printed log by matching text, chunk by
 * chunk with no line buffering — a reworded log line or a chunk split mid-line was
 * enough to lose one. Absent when this runs by hand: then the log is all there is.
 */
function tellApp(msg) {
    if (!process.send) return;
    try {
        process.send(msg);
    } catch {
        // The channel closes as the app quits; nothing left to tell.
    }
}

/** The line sync-once.js prints once a cycle's rows are queryable. */
const APPLIED_MARK = "__SYNC_APPLIED__ ";

/**
 * Feed a stream's chunks, get whole lines. A chunk can end mid-line, and the applied
 * line — a marker plus a JSON tail — must never be read in two halves. `flush` hands
 * over a last line with no newline once the stream closes.
 */
function lineReader(onLine) {
    let rest = "";
    const feed = (buf) => {
        const parts = (rest + String(buf)).split("\n");
        rest = parts.pop();
        for (const line of parts) onLine(line);
    };
    feed.flush = () => {
        if (rest) onLine(rest);
        rest = "";
    };
    return feed;
}

if (!fs.existsSync(CONFIG)) {
    log(`No config.json at ${CONFIG}. Copy config.example.json and fill it in.`);
    process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));


let running = false;
/** A signal that arrived mid-cycle: run once more when this one finishes. */
let queued = false;
let timer = null;
let stopSignal = () => {};
let stopLocalSignal = () => {};
let shuttingDown = false;

/** Targeted pulls the app has asked for and no cycle has picked up yet. */
let relayQueue = [];
/** The targeted pull the running cycle is serving, so its ids can be answered. */
let inFlight = null;
/** The running cycle's process, so a targeted pull can step it aside. */
let child = null;
/** True while a cycle is being killed on purpose to make room for a targeted pull. */
let preempting = false;
/** The running cycle is the re-run of one that was stepped aside: it finishes. */
let protectedCycle = false;
/** Carry the protection to the cycle `queued` will start. */
let queuedProtected = false;
/** Tables the office reported hard deletes on, not yet handed to a cycle. Drained by the
 *  next non-relay cycle (`--verify`), so a signal that arrives mid-cycle is not lost. */
let pendingVerify = new Set();
/** Set on schema drift (exit 4). A targeted pull cannot succeed until a deploy fixes
 *  it, so it is answered at once instead of spawning a doomed child per bill. */
let schemaHalted = false;

function scheduleNext(ms) {
    if (shuttingDown) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runCycle("interval"), ms);
}

/**
 * Run one cycle. `targeted`, when given, is `{ ids, models }`: the cycle syncs only
 * those models (and their children) and the app is told when it is done — whatever the
 * outcome, because a held response must be released on failure too, not after its
 * own timeout.
 */
function runCycle(reason, targeted = null, opts = {}) {
    if (shuttingDown) return;
    if (running) {
        // Never run two cycles at once: they would fight over the same tables and
        // the same watermarks. Remember that one is owed instead.
        queued = true;
        return;
    }
    running = true;
    inFlight = targeted;
    protectedCycle = !!opts.protected;
    log(`cycle start (${reason}${targeted ? `: ${targeted.models.length} model(s)` : ""}${opts.protected ? ", resumed" : ""})`);

    // Tell the cycle what woke it: a signal-woken cycle may trust a recent schema
    // check (see SCHEMA_TRUST_MS in sync-once.js); every other kind re-checks.
    const reasonArg = reason === "change signal" ? "signal"
        : reason === "queued signal" ? "queued"
            : reason;
    const cycleArgs = [path.resolve(__dirname, "sync-once.js"), "--reason", reasonArg];
    if (targeted && targeted.models.length > 0) cycleArgs.push("--only", targeted.models.join(","));
    // A relay cycle skips the reconcile pass, so the deletes wait for the next one.
    if (!targeted && pendingVerify.size > 0) {
        cycleArgs.push("--verify", [...pendingVerify].join(","));
        log(`  reconciling now after office delete: ${[...pendingVerify].join(", ")}`);
        pendingVerify = new Set();
    }
    child = spawn(process.execPath, cycleArgs, {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "pipe"],
    });

    const kill = setTimeout(() => {
        log("cycle exceeded its timeout - killing it; the next tick will retry");
        child.kill("SIGKILL");
    }, CYCLE_TIMEOUT_MS);

    const onLine = (line) => {
        if (!line.trim()) return;
        log(`  ${line.trimEnd()}`);
        if (!line.startsWith(APPLIED_MARK)) return;
        try {
            const info = JSON.parse(line.slice(APPLIED_MARK.length));
            tellApp({ type: "applied", rows: info.rows, models: info.models });
        } catch {
            // A mangled line is a log message, not worth losing the worker over.
        }
    };
    const out = lineReader(onLine);
    const err = lineReader(onLine);
    child.stdout.on("data", out);
    child.stderr.on("data", err);
    // `close`, not `exit`: the streams can still be delivering after the process ends.
    child.on("close", () => {
        out.flush();
        err.flush();
    });

    child.on("exit", (code) => {
        clearTimeout(kill);
        running = false;
        child = null;
        protectedCycle = false;
        const served = inFlight;
        inFlight = null;
        if (served) void localSignal.notifyDone(cfg, { ids: served.ids, ok: code === 0 }, log);

        if (preempting) {
            // Killed on purpose (see onRelayPull). Its work is per-table transactional,
            // so nothing is half-written; it runs again after the targeted pull, and
            // that re-run is protected so a busy till cannot starve it forever.
            preempting = false;
            log(`cycle (${reason}) stepped aside for a targeted pull; it resumes afterwards`);
            queued = true;
            queuedProtected = true;
            setImmediate(runRelayCycle);
            return;
        }
        if (code === 0) schemaHalted = false;

        if (code === 4) {
            schemaHalted = true;
            // Schema drift. Retrying on the usual interval would spam the log with a
            // fault only a deploy can fix, so back off hard and stay loud. Targeted
            // pulls cannot succeed either, so answer them now rather than never.
            log("SCHEMA DRIFT - sync halted. Update the app artifact / reseed the replica.");
            tellApp({ type: "drift" });
            answerRelayQueue(false);
            scheduleNext(INTERVAL_MS * 3);
            return;
        }
        if (code !== 0) {
            log(`cycle failed (exit ${code}) - retrying in ${RETRY_MS / 1000}s`);
            scheduleNext(RETRY_MS);
            // A waiting targeted pull is a person at a till; it does not wait out the
            // backoff. One attempt, then it is answered whichever way it went.
            if (relayQueue.length) setImmediate(runRelayCycle);
            return;
        }

        log("cycle ok");
        tellApp({ type: "cycle-ok" });
        if (relayQueue.length) {
            // Someone is holding a response for this; it goes before anything else.
            setImmediate(runRelayCycle);
            return;
        }
        if (queued) {
            queued = false;
            const protect = queuedProtected;
            queuedProtected = false;
            // Something changed while we were working; go again rather than making
            // it wait out the whole interval.
            setImmediate(() => runCycle("queued signal", null, { protected: protect }));
            return;
        }
        scheduleNext(INTERVAL_MS);
    });
}

/** Fold every waiting targeted pull into one cycle: the union of their models, all
 *  their ids answered together. */
function runRelayCycle() {
    if (running || shuttingDown || relayQueue.length === 0) return;
    const batch = relayQueue.splice(0);
    const ids = batch.map((r) => r.id);
    const models = [...new Set(batch.flatMap((r) => r.models))];
    runCycle("relay", { ids, models });
}

/** Release every waiting targeted pull without running it (schema drift). */
function answerRelayQueue(ok) {
    if (relayQueue.length === 0) return;
    const ids = relayQueue.splice(0).map((r) => r.id);
    void localSignal.notifyDone(cfg, { ids, ok }, log);
}

function onRelayPull(request) {
    if (schemaHalted) {
        void localSignal.notifyDone(cfg, { ids: [request.id], ok: false }, log);
        return;
    }
    relayQueue.push(request);
    if (!running) {
        runRelayCycle();
        return;
    }
    // A safety-net cycle is in the way — and after every relayed write the app's own
    // change signal starts one, so this is the common case, not the exception. The
    // cycle is a safety net; the person at the till is not. Step it aside: it is
    // killed (per-table transactions, nothing half-written), the targeted pull runs,
    // and the interrupted cycle resumes protected from a second pre-emption. A
    // targeted cycle already running is left alone: this request folds into the next.
    if (child && !inFlight && !protectedCycle && !preempting) {
        preempting = true;
        log("targeted pull requested mid-cycle - stepping the running cycle aside");
        child.kill("SIGKILL");
    }
}

// A signal only ever makes a sync happen SOONER. Correctness lives in the
// watermarks and the reconcile pass, which run on the interval regardless.
stopSignal = signal.listen(cfg, (deleted) => {
    for (const m of deleted) pendingVerify.add(m);
    runCycle("change signal");
}, log);
stopLocalSignal = localSignal.listen(cfg, onRelayPull, log);

log(`counter-sync started (interval ${INTERVAL_MS / 60000}m)`);
runCycle("startup");

/** How long a cycle in flight may run on after a stop is asked, unless told otherwise. */
const SHUTDOWN_GRACE_MS = 4000;

function shutdown(why, graceMs = SHUTDOWN_GRACE_MS) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${why} - shutting down`);
    if (timer) clearTimeout(timer);
    try { stopSignal(); } catch { /* going away anyway */ }
    try { stopLocalSignal(); } catch { /* going away anyway */ }
    // Waiting targeted pulls are not answered: the process is going, so a NOTIFY could
    // not be relied on anyway. The app's own timeout releases them.
    const cycle = child;
    if (!cycle) process.exit(0);
    // A cycle in flight gets `graceMs` to finish on its own; past that it is ended. It
    // is never left behind: an orphaned cycle kept writing into the replica after the
    // app had stopped syncing, and was still connected when PostgreSQL was stopped under
    // it. Ending one loses nothing — every page is its own transaction, and the totals
    // it owed are in `_sync_dirty` for the next cycle (lib/rebuildTotals.js).
    const force = setTimeout(() => {
        log("cycle still running - ending it; the next start redoes what it had left");
        cycle.kill("SIGKILL");
    }, graceMs);
    cycle.once("exit", () => {
        clearTimeout(force);
        process.exit(0);
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
// The desktop app asks over IPC (electron/syncManager.ts stopSyncWorker): on Windows a
// signal from it is a hard kill, which would never reach the handlers above.
process.on("message", (msg) => {
    if (msg && msg.type === "shutdown") shutdown("app asked", msg.graceMs);
});
