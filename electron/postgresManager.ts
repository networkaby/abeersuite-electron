import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { app } from "electron";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

const DEFAULT_PG_PORT = 5432;
const EMBEDDED_PG_PORT = 54329;
let pgProcess: ChildProcess | null = null;

/**
 * Per-machine opt-in for the local replica, persisted in userData so it survives
 * upgrades without needing `COUNTER_PC` baked into the shared installer (every
 * counter's build is identical — see `scripts/counterEnv.ts`). Owner decision:
 * auto-detect at first run, no installer prompt — so this defaults to enabled and
 * there is currently no UI that writes `{enabled: false}` here; that is the hook
 * for a future "disable local replica" setting, not a dead file format.
 */
function getReplicaSettingsPath(): string {
    return path.join(app.getPath("userData"), "replica.json");
}

function isReplicaEnabled(): boolean {
    // Explicit env override always wins — for dev/testing without touching userData.
    if (process.env.COUNTER_PC === "1") return true;
    if (process.env.COUNTER_PC === "0") return false;
    try {
        const parsed = JSON.parse(fs.readFileSync(getReplicaSettingsPath(), "utf-8")) as { enabled?: boolean };
        if (typeof parsed.enabled === "boolean") return parsed.enabled;
    } catch {
        // No settings file yet, or it's unreadable — fall through to the default below.
    }
    return true;
}

/** Actually connects — a listening port alone does not mean a usable `smx` database. */
async function canConnect(connectionString: string, timeoutMs = 1500): Promise<boolean> {
    const client = new PgClient({ connectionString, connectionTimeoutMillis: timeoutMs });
    try {
        await client.connect();
        await client.query("SELECT 1");
        return true;
    } catch {
        return false;
    } finally {
        await client.end().catch(() => {});
    }
}

/**
 * Checks whether a given TCP port is actively listening on localhost.
 */
export function isPortListening(port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = false;

        socket.setTimeout(timeoutMs);

        socket.on("connect", () => {
            status = true;
            socket.destroy();
            resolve(true);
        });

        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });

        socket.on("error", () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, "127.0.0.1");
    });
}

/**
 * Resolves the directory where embedded PostgreSQL binaries are stored.
 */
function getEmbeddedBinPath(): string {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    if (isDev) {
        return path.join(process.cwd(), "resources", "pgsql", "bin");
    }
    return path.join(process.resourcesPath, "pgsql", "bin");
}

/**
 * Resolves the data directory for the embedded PostgreSQL cluster.
 */
function getEmbeddedDataPath(): string {
    const userData = app.getPath("userData");
    return path.join(userData, "pgdata");
}

/**
 * Ensures the local PostgreSQL replica is running and returns its connection string,
 * or `null` when this machine does not run a replica at all.
 *
 * v1 ships in **live mode**: the counter reads and writes straight to Supabase, and
 * that stays true here too — every path below falls through to `null` on any failure,
 * never a half-working connection string. `reportLiveDown()` in
 * `src/shared/lib/prisma/counterMode.ts` demotes reads to LOCAL on any transient
 * Supabase error, and `shouldReadLocal()` then returns true regardless of
 * `replicaReady` — so a connection string pointing at a database that does not exist
 * or cannot be reached would turn a brief network blip into a hard failure. Left
 * unset, `prismaClient.ts` collapses cleanly to single-client live behaviour.
 *
 * Auto-detect, no installer prompt (owner decision): an already-installed PostgreSQL
 * on the standard port always wins over the embedded one, checked first and
 * independent of whether the embedded binaries are bundled at all.
 */
export async function ensurePostgresRunning(): Promise<string | null> {
    if (!isReplicaEnabled()) {
        console.log("[PostgresManager] Local replica disabled for this machine — running in live mode.");
        return null;
    }

    // 1. An already-installed PostgreSQL, if one answers and actually has the
    //    database this app needs — a listening port alone proves nothing.
    const installedUrl = `postgresql://postgres@localhost:${DEFAULT_PG_PORT}/smx`;
    if (await isPortListening(DEFAULT_PG_PORT, 800) && await canConnect(installedUrl)) {
        console.log(`[PostgresManager] Using the PostgreSQL already installed on this PC (port ${DEFAULT_PG_PORT}).`);
        process.env.LOCAL_DATABASE_URL = installedUrl;
        process.env.LOCAL_DATABASE_SOURCE = "installed";
        return installedUrl;
    }

    // 2. An embedded instance already running from a previous launch.
    const embeddedUrl = `postgresql://postgres@localhost:${EMBEDDED_PG_PORT}/smx`;
    if (await isPortListening(EMBEDDED_PG_PORT, 800) && await canConnect(embeddedUrl)) {
        console.log(`[PostgresManager] Using the already-running embedded PostgreSQL (port ${EMBEDDED_PG_PORT}).`);
        process.env.LOCAL_DATABASE_URL = embeddedUrl;
        process.env.LOCAL_DATABASE_SOURCE = "embedded";
        return embeddedUrl;
    }

    // 3. Nothing already running — try to start the embedded one. Only does
    //    anything once its binaries are actually bundled or downloaded; today
    //    resources/pgsql is empty (download-on-first-online-run is not yet built),
    //    so this is the common exit and the app stays in live mode.
    const binDir = getEmbeddedBinPath();
    const dataDir = getEmbeddedDataPath();
    const postgresExe = path.join(binDir, process.platform === "win32" ? "postgres.exe" : "postgres");
    const initdbExe = path.join(binDir, process.platform === "win32" ? "initdb.exe" : "initdb");

    if (!fs.existsSync(postgresExe)) {
        console.log(
            "[PostgresManager] No installed PostgreSQL found and no embedded binaries at " +
            `${binDir} — staying in live mode (no local replica).`
        );
        return null;
    }

    // Initialize database cluster if dataDir does not exist or is empty
    if (!fs.existsSync(dataDir) || fs.readdirSync(dataDir).length === 0) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log("[PostgresManager] Initializing fresh embedded PostgreSQL cluster in:", dataDir);
        try {
            const initProc = spawn(initdbExe, ["-D", dataDir, "-U", "postgres", "--auth=trust"], {
                stdio: "inherit",
            });
            await new Promise<void>((resolve, reject) => {
                initProc.on("exit", (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`initdb exited with code ${code}`));
                });
            });
        } catch (err) {
            console.error("[PostgresManager] Failed to initdb:", err);
        }
    }

    // Start embedded PostgreSQL daemon
    console.log(`[PostgresManager] Starting embedded PostgreSQL on port ${EMBEDDED_PG_PORT}...`);
    let ready = false;
    try {
        pgProcess = spawn(postgresExe, ["-D", dataDir, "-p", String(EMBEDDED_PG_PORT)], {
            detached: false,
            stdio: "ignore",
        });

        pgProcess.on("error", (err) => {
            console.error("[PostgresManager] Failed to start postgres process:", err);
        });

        // Wait up to 5 seconds for port to become ready
        for (let i = 0; i < 25; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await isPortListening(EMBEDDED_PG_PORT, 200)) {
                console.log(`[PostgresManager] Embedded PostgreSQL is ready on port ${EMBEDDED_PG_PORT}.`);
                ready = true;
                break;
            }
        }
    } catch (err) {
        console.error("[PostgresManager] Error spawning postgres:", err);
    }

    if (!ready) {
        console.warn("[PostgresManager] Embedded PostgreSQL never became ready — staying in live mode.");
        return null;
    }

    process.env.LOCAL_DATABASE_URL = embeddedUrl;
    process.env.LOCAL_DATABASE_SOURCE = "embedded";
    return embeddedUrl;
}

/**
 * Gracefully terminates the embedded PostgreSQL process on app exit.
 *
 * On Windows `SIGTERM` is not supported by Node.js — the process receives
 * `SIGKILL` instead, which means an unclean shutdown and possible `pgdata`
 * corruption.  We therefore use `pg_ctl stop -m fast` on Windows, which sends
 * the proper shutdown signal through PostgreSQL's own mechanism.
 */
export function stopEmbeddedPostgres(): void {
    if (pgProcess && !pgProcess.killed) {
        console.log("[PostgresManager] Stopping embedded PostgreSQL...");
        try {
            if (process.platform === "win32") {
                const pgCtl = path.join(getEmbeddedBinPath(), "pg_ctl.exe");
                const dataDir = getEmbeddedDataPath();
                spawnSync(pgCtl, ["stop", "-D", dataDir, "-m", "fast"], {
                    timeout: 10_000,
                    stdio: "ignore",
                });
            } else {
                pgProcess.kill("SIGTERM");
            }
        } catch (err) {
            console.error("[PostgresManager] Error stopping postgres:", err);
        }
        pgProcess = null;
    }
}
