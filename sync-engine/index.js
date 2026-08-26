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
 * Three things make a cycle happen:
 *   - a change signal from the app (fast path, ~1s)
 *   - the interval (the safety net, because a signal is only ever a hint: writes
 *     from scripts, seeds and the GitHub-Actions restore emit nothing at all)
 *   - startup
 */

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const signal = require("./lib/signal");

const { configPath } = require("./lib/configPath");
const CONFIG = configPath();

/**
 * The safety net, not the mechanism. Long on purpose: the signal covers anything a
 * person does, so this only has to catch writes with no browser behind them.
 */
const INTERVAL_MS = 10 * 60 * 1000;

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
let shuttingDown = false;

function scheduleNext(ms) {
    if (shuttingDown) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runCycle("interval"), ms);
}

function runCycle(reason) {
    if (shuttingDown) return;
    if (running) {
        // Never run two cycles at once: they would fight over the same tables and
        // the same watermarks. Remember that one is owed instead.
        queued = true;
        return;
    }
    running = true;
    log(`cycle start (${reason})`);

    const child = spawn(process.execPath, [path.resolve(__dirname, "sync-once.js")], {
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

        if (code === 4) {
            // Schema drift. Retrying on the usual interval would spam the log with a
            // fault only a deploy can fix, so back off hard and stay loud.
            log("SCHEMA DRIFT - sync halted. Update the app artifact / reseed the replica.");
            scheduleNext(INTERVAL_MS * 3);
            return;
        }
        if (code !== 0) {
            log(`cycle failed (exit ${code}) - retrying in ${RETRY_MS / 1000}s`);
            scheduleNext(RETRY_MS);
            return;
        }

        log("cycle ok");
        if (queued) {
            queued = false;
            // Something changed while we were working; go again rather than making
            // it wait out the whole interval.
            setImmediate(() => runCycle("queued signal"));
            return;
        }
        scheduleNext(INTERVAL_MS);
    });
}

// A signal only ever makes a sync happen SOONER. Correctness lives in the
// watermarks and the reconcile pass, which run on the interval regardless.
stopSignal = signal.listen(cfg, () => runCycle("change signal"), log);

log(`counter-sync started (interval ${INTERVAL_MS / 60000}m)`);
runCycle("startup");

function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${sig} - shutting down`);
    if (timer) clearTimeout(timer);
    try { stopSignal(); } catch { /* going away anyway */ }
    // A cycle in flight is left to finish: it is transactional, and killing it mid
    // write buys nothing that a rollback would not already give us.
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
