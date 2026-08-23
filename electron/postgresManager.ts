import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { app } from "electron";

const DEFAULT_PG_PORT = 5432;
const EMBEDDED_PG_PORT = 54329;
let pgProcess: ChildProcess | null = null;

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
 * v1 ships in **live mode**: the counter reads and writes straight to Supabase. The
 * replica path stays dormant unless a machine is explicitly marked `COUNTER_PC=1`
 * *and* the portable binaries are actually bundled.
 *
 * `LOCAL_DATABASE_URL` is only ever set once a local server is confirmed listening.
 * Setting it speculatively is dangerous: `reportLiveDown()` in
 * `src/shared/lib/prisma/counterMode.ts` demotes reads to LOCAL on any transient
 * Supabase error, and `shouldReadLocal()` then returns true regardless of
 * `replicaReady` — so a connection string pointing at a database that does not exist
 * would turn a brief network blip into a hard failure. Left unset, `prismaClient.ts`
 * collapses cleanly to single-client live behaviour, which is what we want.
 */
export async function ensurePostgresRunning(): Promise<string | null> {
    if (process.env.COUNTER_PC !== "1") {
        console.log("[PostgresManager] COUNTER_PC is not set — running in live mode, skipping local PostgreSQL.");
        return null;
    }

    const binDir = getEmbeddedBinPath();
    const dataDir = getEmbeddedDataPath();
    const postgresExe = path.join(binDir, process.platform === "win32" ? "postgres.exe" : "postgres");
    const initdbExe = path.join(binDir, process.platform === "win32" ? "initdb.exe" : "initdb");

    if (!fs.existsSync(postgresExe)) {
        console.warn(
            "[PostgresManager] COUNTER_PC=1 but no bundled PostgreSQL binaries at " +
            `${binDir} — staying in live mode (no local replica).`
        );
        return null;
    }

    // 1. Check if an existing system PostgreSQL is already running on standard port 5432
    const defaultRunning = await isPortListening(DEFAULT_PG_PORT, 800);
    if (defaultRunning) {
        console.log(`[PostgresManager] Detected active PostgreSQL instance on port ${DEFAULT_PG_PORT}. Using it.`);
        process.env.LOCAL_DATABASE_URL = `postgresql://postgres@localhost:${DEFAULT_PG_PORT}/smx`;
        return process.env.LOCAL_DATABASE_URL;
    }

    // 2. Check if embedded PostgreSQL is already running on the isolated port 54329
    const embeddedRunning = await isPortListening(EMBEDDED_PG_PORT, 800);
    if (embeddedRunning) {
        console.log(`[PostgresManager] Detected active embedded PostgreSQL instance on port ${EMBEDDED_PG_PORT}. Using it.`);
        process.env.LOCAL_DATABASE_URL = `postgresql://postgres@localhost:${EMBEDDED_PG_PORT}/smx`;
        return process.env.LOCAL_DATABASE_URL;
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

    process.env.LOCAL_DATABASE_URL = `postgresql://postgres@localhost:${EMBEDDED_PG_PORT}/smx`;
    return process.env.LOCAL_DATABASE_URL;
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
