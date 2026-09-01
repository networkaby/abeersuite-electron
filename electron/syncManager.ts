/**
 * Supervises the replica sync worker (`sync-engine/`).
 *
 * That worker used to be a separate product: its own repo at `tools/counter-sync`, its
 * own installer, and its own SYSTEM scheduled task running beside the printer bridge.
 * A counter therefore needed PostgreSQL installed by hand, plus two more things to
 * install and keep running. Owner decision, 2026-08-26: one box. The engine moved into
 * this repo unchanged — it is proven against real data (113 tables, 20134 rows, exact
 * match) and rewriting it would trade that for nothing — and Electron now starts and
 * stops it like it already does the Next server.
 *
 * ── Why a child process rather than in-process ───────────────────────────────
 * Two reasons, and they compound. The worker's own scheduler already runs each *cycle*
 * as a child, because a sync touches every table and holds two database connections:
 * one leak or one wedged connection would otherwise take it down permanently, whereas a
 * child that dies is just a failed cycle. Keeping the scheduler itself out of the main
 * process extends the same protection upward — a crashed worker must never take the POS
 * window with it.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 * `config.json` holds connection strings for BOTH databases and is never packaged. It
 * is written at runtime into userData, which is per-user and writable; the packaged
 * directory under Program Files is neither. `verify-package.ts` fails the build if a
 * `config.json` is ever found inside the package.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { BrowserWindow } from "electron";
import { app } from "electron";

let worker: ChildProcess | null = null;

/** Mirrors the dev/packaged split used by postgresManager and localDbProvisioner. */
function syncEngineDir(): string {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    return isDev
        ? path.join(process.cwd(), "sync-engine")
        : path.join(process.resourcesPath, "sync-engine");
}

function configFilePath(): string {
    return path.join(app.getPath("userData"), "sync-config.json");
}

/**
 * Writes the worker's config from what this process already holds.
 *
 * `sourceUrl` is the ordinary pooler `DATABASE_URL`, not a direct 5432 session URL.
 * The standalone tool needed 5432 because it seeded with `pg_dump`; this build does not
 * seed that way — the schema is applied from `resources/local-schema.sql` and the pull
 * engine drains every table from a NULL watermark — so the direct credential never has
 * to reach a shop PC. See `scripts/counterEnv.ts`, which withholds `DIRECT_URL` on
 * purpose.
 *
 * The Supabase pair is optional: without it the worker falls back to its 10-minute
 * timer instead of syncing on the app's change signal. Both are `NEXT_PUBLIC_*` values,
 * client-exposed by design.
 */
function writeConfig(syncUrl: string): string | null {
    const sourceUrl = process.env.DATABASE_URL;
    if (!sourceUrl) {
        console.error("[SyncManager] No DATABASE_URL — cannot configure the sync worker.");
        return null;
    }

    const config = {
        sourceUrl,
        localUrl: syncUrl,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    };

    const file = configFilePath();
    try {
        fs.writeFileSync(file, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
        return file;
    } catch (err) {
        console.error("[SyncManager] Could not write the sync worker's config:", err);
        return null;
    }
}

/**
 * Starts the worker. Never throws and never blocks boot: a counter with no sync worker
 * still reads and writes its local replica, it just stops receiving changes made
 * elsewhere — degraded, not broken.
 */
export function startSyncWorker(syncUrl: string): void {
    if (worker) return;

    const dir = syncEngineDir();
    const entry = path.join(dir, "index.js");
    if (!fs.existsSync(entry)) {
        console.error(`[SyncManager] No sync worker at ${entry} — the replica will not receive updates.`);
        return;
    }

    const configFile = writeConfig(syncUrl);
    if (!configFile) return;

    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so the
    // worker needs no separate Node runtime installed on the counter — the whole point
    // of shipping one box.
    worker = spawn(process.execPath, [entry], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            COUNTER_SYNC_CONFIG: configFile,
        },
    });

    const relay = (buf: Buffer) => {
        for (const line of String(buf).split("\n")) {
            if (line.trim()) console.log(`[sync] ${line.trimEnd()}`);
        }
    };
    worker.stdout?.on("data", relay);
    worker.stderr?.on("data", relay);

    worker.on("error", (err) => {
        console.error("[SyncManager] Sync worker failed to start:", err);
        worker = null;
    });

    worker.on("exit", (code, sig) => {
        // Deliberately not restarted here. The worker already retries internally and
        // backs off hard on schema drift (a fault only a deploy can fix); a restart loop
        // in this process would just hide that and hammer the source.
        console.log(`[SyncManager] Sync worker exited (code ${code}, signal ${sig}).`);
        worker = null;
    });

    console.log("[SyncManager] Sync worker started.");
}

/**
 * The worker prints one machine-readable line, after a cycle has committed rows into
 * the replica (`__SYNC_APPLIED__` in sync-engine/sync-once.js). Forward it to every
 * window so screens re-read once the data is ACTUALLY there, instead of racing the
 * worker on the same Realtime signal and losing.
 *
 * Matched on the raw line rather than a clean protocol because the text passes through
 * two relays that each prefix it; the marker plus a JSON tail survives both. A line that
 * does not parse is ignored — a log message is not worth crashing a boot path for.
 */
const APPLIED_RE = /__SYNC_APPLIED__ (\{.*\})\s*$/;

function notifyIfApplied(line: string): void {
    const m = APPLIED_RE.exec(line);
    if (!m) return;
    let info: { rows: number; models: string[] };
    try {
        info = JSON.parse(m[1]);
    } catch {
        return;
    }
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("sync:applied", info);
    }
}

/**
 * Asks the worker to stop. It leaves a cycle in flight to finish — cycles are
 * transactional, so killing one mid-write buys nothing a rollback would not.
 */
export function stopSyncWorker(): void {
    if (!worker || worker.killed) return;
    console.log("[SyncManager] Stopping the sync worker…");
    try {
        worker.kill();
    } catch (err) {
        console.error("[SyncManager] Error stopping the sync worker:", err);
    }
    worker = null;
}
