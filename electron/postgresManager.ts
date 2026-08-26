import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { app } from "electron";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

const DEFAULT_PG_PORT = 5432;
const EMBEDDED_PG_PORT = 54329;

/**
 * The database this app keeps its replica in. A constant, never user input — which is
 * what makes it safe to interpolate into the `CREATE DATABASE` below, where PostgreSQL
 * does not accept a bind parameter.
 */
const LOCAL_DB_NAME = "smx";

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
 * `initdb` creates a cluster containing only `postgres` and the `template*` databases —
 * never the one this app connects to. Nothing used to create it, so the spawn path
 * below handed back `postgresql://…/smx` against a cluster where `smx` did not exist,
 * and every launch after the first was rescued only by `canConnect()` refusing it.
 *
 * Connects to the always-present `postgres` database to do it. Returns false rather
 * than throwing — the caller's contract is "null on any doubt", not "crash the boot".
 */
async function ensureLocalDatabase(port: number): Promise<boolean> {
    const adminUrl = `postgresql://postgres@localhost:${port}/postgres`;
    const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [LOCAL_DB_NAME]);
        if (existing.rowCount === 0) {
            // CREATE DATABASE takes no bind parameters and cannot run inside a
            // transaction. LOCAL_DB_NAME is a module constant, never user input.
            console.log(`[PostgresManager] Creating the "${LOCAL_DB_NAME}" database (first run on this machine).`);
            await client.query(`CREATE DATABASE "${LOCAL_DB_NAME}"`);
        }
        return true;
    } catch (err) {
        console.error(`[PostgresManager] Could not create or verify the "${LOCAL_DB_NAME}" database:`, err);
        return false;
    } finally {
        await client.end().catch(() => {});
    }
}

/**
 * Starts the embedded daemon, initialising the cluster first if this is a fresh
 * machine. Returns false when the binaries are absent or the server never came up —
 * both of which mean "stay in live mode", not "fail".
 */
async function startEmbeddedPostgres(): Promise<boolean> {
    const binDir = getEmbeddedBinPath();
    const dataDir = getEmbeddedDataPath();
    const postgresExe = path.join(binDir, process.platform === "win32" ? "postgres.exe" : "postgres");
    const initdbExe = path.join(binDir, process.platform === "win32" ? "initdb.exe" : "initdb");

    if (!fs.existsSync(postgresExe)) {
        console.log(
            `[PostgresManager] No embedded PostgreSQL binaries at ${binDir} — staying in live mode ` +
            "(no local replica). They are fetched on first online run once the downloader ships."
        );
        return false;
    }

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
            // A half-initialised dataDir cannot be started, so there is nothing to
            // salvage — bail instead of spawning against it.
            console.error("[PostgresManager] Failed to initdb:", err);
            return false;
        }
    }

    console.log(`[PostgresManager] Starting embedded PostgreSQL on port ${EMBEDDED_PG_PORT}...`);
    try {
        pgProcess = spawn(postgresExe, ["-D", dataDir, "-p", String(EMBEDDED_PG_PORT)], {
            detached: false,
            stdio: "ignore",
        });

        pgProcess.on("error", (err) => {
            console.error("[PostgresManager] Failed to start postgres process:", err);
        });

        // Wait up to 5 seconds for the port to become ready.
        for (let i = 0; i < 25; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await isPortListening(EMBEDDED_PG_PORT, 200)) {
                console.log(`[PostgresManager] Embedded PostgreSQL is ready on port ${EMBEDDED_PG_PORT}.`);
                return true;
            }
        }
    } catch (err) {
        console.error("[PostgresManager] Error spawning postgres:", err);
        return false;
    }

    console.warn("[PostgresManager] Embedded PostgreSQL never became ready — staying in live mode.");
    return false;
}

/**
 * Ensures the local PostgreSQL replica is running and returns its connection string,
 * or `null` when this machine does not run a replica at all.
 *
 * Every path falls through to `null` on any failure, never a half-working connection
 * string. `reportLiveDown()` in `src/shared/lib/prisma/counterMode.ts` demotes reads to
 * LOCAL on any transient Supabase error, and `shouldReadLocal()` then returns true
 * regardless of `replicaReady` — so a connection string pointing at a database that
 * does not exist or cannot be reached would turn a brief network blip into a hard
 * failure. Left unset, `prismaClient.ts` collapses cleanly to single-client live
 * behaviour.
 *
 * **Embedded only.** This deliberately no longer looks for a PostgreSQL already
 * installed on the PC. That probe used a hardcoded passwordless
 * `postgres@localhost:5432` URL, which only ever works against the embedded cluster's
 * own `--auth=trust` — a real installed server uses scram and would have rejected it
 * anyway. Worse, when it did connect, a counter silently bound itself to whatever
 * database happened to be on that machine. See `ALLOW_EXITING_DB` below.
 */
export async function ensurePostgresRunning(): Promise<string | null> {
    if (!isReplicaEnabled()) {
        console.log("[PostgresManager] Local replica disabled for this machine — running in live mode.");
        return null;
    }

    // TODO(installer): honour this properly once the installer collects the local
    // server's username and password. A pre-installed PostgreSQL cannot be reached
    // without credentials, and they cannot be baked into the shared installer because
    // every PC's are different — they belong in the per-machine %APPDATA% .env that
    // loadCounterEnv() already loads first. Recognised and logged now so the flag does
    // not look silently ignored; deliberately NOT a hard failure.
    if (process.env.ALLOW_EXITING_DB === "1") {
        console.warn(
            `[PostgresManager] ALLOW_EXITING_DB=1 requests the PostgreSQL already installed on this PC ` +
            `(port ${DEFAULT_PG_PORT}), but that is not supported yet — its username and password are ` +
            "collected during installation, which is not built. Using the embedded server instead."
        );
    }

    const embeddedUrl = `postgresql://postgres@localhost:${EMBEDDED_PG_PORT}/${LOCAL_DB_NAME}`;

    // 1. Adopt an embedded instance still running from a previous launch, otherwise
    //    start one. Checked by port, not by canConnect: the database itself may not
    //    exist yet, which step 2 is what fixes.
    if (await isPortListening(EMBEDDED_PG_PORT, 800)) {
        console.log(`[PostgresManager] Using the already-running embedded PostgreSQL (port ${EMBEDDED_PG_PORT}).`);
    } else if (!await startEmbeddedPostgres()) {
        return null;
    }

    // 2. The cluster is up, but a fresh one holds no `smx` database.
    if (!await ensureLocalDatabase(EMBEDDED_PG_PORT)) return null;

    // 3. Prove the URL we are about to hand out actually works before handing it out.
    if (!await canConnect(embeddedUrl)) {
        console.warn("[PostgresManager] Embedded PostgreSQL is up but unreachable — staying in live mode.");
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
