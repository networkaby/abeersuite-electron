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
    child = spawn(process.execPath, cycleArgs, {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "pipe"],
    });

    const kill = setTimeout(() => {
        log("cycle exceeded its timeout - killing it; the next tick will retry");
        child.kill("SIGKILL");
    }, CYCLE_TIMEOUT_MS);

    const relay = (buf) => {
        for (const line of String(buf).split("\n")) {
            if (line.trim()) log(`  ${line.trimEnd()}`);
        }
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);

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
stopSignal = signal.listen(cfg, () => runCycle("change signal"), log);
stopLocalSignal = localSignal.listen(cfg, onRelayPull, log);

log(`counter-sync started (interval ${INTERVAL_MS / 60000}m)`);
runCycle("startup");

function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${sig} - shutting down`);
    if (timer) clearTimeout(timer);
    try { stopSignal(); } catch { /* going away anyway */ }
    try { stopLocalSignal(); } catch { /* going away anyway */ }
    // Waiting targeted pulls are not answered: the process exits on the next line, so
    // a NOTIFY could not be sent anyway. The app's own timeout releases them.
    // A cycle in flight is left to finish: it is transactional, and killing it mid
    // write buys nothing that a rollback would not already give us.
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
