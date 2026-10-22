import * as path from "path";
import * as net from "net";
import { app } from "electron";
import { fork, type ChildProcess } from "child_process";

import * as http from "http";
import { HelperSupervisor } from "./helperSupervisor";

let nextProcess: ChildProcess | null = null;

/** Brings a crashed server back (see helperSupervisor.ts). */
const supervisor = new HelperSupervisor("server", "App server");

/** The server has answered at least once, so a restart has a window to refresh. */
let answeredOnce = false;
let onRestarted: ((url: string) => void) | null = null;

/** main.ts: told the URL once a server restarted after a crash answers again. */
export function onNextServerRestarted(fn: (url: string) => void): void {
    onRestarted = fn;
}

/** Result of a boot attempt. `ready: false` means the caller must not treat `url` as live. */
export interface ServerStartResult {
    url: string;
    ready: boolean;
}

/**
 * Checks whether a given TCP port is actively listening on localhost.
 * Re-exported here so postgresManager can keep importing from this module.
 */
export function isPortListeningLocal(port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.on("connect", () => { socket.destroy(); resolve(true); });
        socket.on("timeout", () => { socket.destroy(); resolve(false); });
        socket.on("error", () => { socket.destroy(); resolve(false); });
        socket.connect(port, "127.0.0.1");
    });
}

/**
 * Probes an HTTP endpoint on localhost to verify the Next.js server is not just
 * TCP listening, but actively ready to handle and serve HTTP web requests.
 */
function isHttpReady(url: string, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            res.resume(); // Drain stream to free memory
            const code = res.statusCode ?? 500;
            // Any response code below 500 means Next.js router is handling requests
            resolve(code < 500);
        });
        req.on("timeout", () => { req.destroy(); resolve(false); });
        req.on("error", () => { req.destroy(); resolve(false); });
    });
}

/**
 * Starts the Next.js production server by forking the standalone `server.js`
 * that `next build` (with `output: "standalone"`) produced.
 *
 * In dev mode (NODE_ENV=development or unpackaged) the dev server is expected
 * to already be running — we just return the URL and skip spawning.
 */
export async function startNextServer(port = 3000, compileCacheDir?: string): Promise<ServerStartResult> {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    if (isDev) {
        // package.json's electron:dev script runs `wait-on` before launching Electron,
        // so the dev server is already confirmed reachable by the time we get here.
        return { url: `http://127.0.0.1:${port}`, ready: true };
    }

    supervisor.reset();
    const result = await bootServer(port, compileCacheDir);
    if (result.ready) answeredOnce = true;
    return result;
}

/**
 * Forks the server and waits for it to answer. Also the restart after a crash: the
 * window is reloaded once the new one answers (main.ts), since every page it held was
 * served by the process that died.
 */
async function bootServer(port: number, compileCacheDir?: string): Promise<ServerStartResult> {
    // No "reuse an existing listener" path here on purpose: it used to adopt *any*
    // process already on the port, including a stray `next dev` left running from
    // this same machine, and load a foreign app into the POS window. Single-instance
    // locking (main.ts) already stops two copies of this app from racing each other;
    // if the port is genuinely stuck (an orphaned process from an unclean exit), the
    // fork below fails to bind and the readiness poll times out below, which the
    // caller turns into a visible error instead of a silent wrong-app load.

    // The standalone directory is placed into extraResources by electron-builder.
    // `scripts/prepare-standalone.ts` hoists its node_modules into real directories at
    // build time, so `server.js` resolves `next` from its own folder — no NODE_PATH
    // needed. (NODE_PATH could not have helped anyway: once `next` loads, its own
    // transitive requires resolve relative to `next`'s location.)
    const standaloneDir = path.join(process.resourcesPath, "standalone");
    const serverScript = path.join(standaloneDir, "server.js");

    const proc = fork(serverScript, [], {
        cwd: standaloneDir,
        env: {
            ...process.env,
            PORT: String(port),
            // LAN-exposed on purpose: staff need to open a counter from another PC's
            // browser (http://<counter-ip>:786). Every counter binds the SAME fixed port
            // (see main.ts resolvePort()) — the counter's IP is what disambiguates it on
            // the shop LAN, not the port, since each counter is its own physical PC.
            // Login is still required at the app layer.
            HOSTNAME: "0.0.0.0",
            NODE_ENV: "production",
            // Stamped on relayed writes (shared/lib/counter/writeRelay.ts) so a version
            // skew between a till and the office is visible in the office's logs.
            APP_VERSION: app.getVersion(),
            ELECTRON_RUN_AS_NODE: "1",
            // Persists V8's compiled-bytecode cache across launches (Node 22+). Doesn't
            // touch the dominant cost (executing module top-level code, e.g. building the
            // Prisma client) but skips recompiling the same ~23MB of server chunks every
            // boot — measured ~0.7s off a real packaged build. Lives in userData, not the
            // app install dir, since electron-builder ships that dir read-only-ish and it
            // must survive updates that replace the standalone folder.
            ...(compileCacheDir ? { NODE_COMPILE_CACHE: compileCacheDir } : {}),
        },
        stdio: "pipe",
    });

    nextProcess = proc;

    // Pipe child stdout/stderr through console logger so it is recorded in main.log.
    proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (text) console.log(`[NextServer] ${text}`);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (text) console.error(`[NextServer:err] ${text}`);
    });

    proc.on("error", (err) => {
        console.error("[NextServer] Fork error:", err);
    });

    proc.on("exit", (code, signal) => {
        console.log(`[NextServer] Process exited (code=${code}, signal=${signal}).`);
        // stopNextServer clears the slot before stopping it, so only a crash gets here.
        if (nextProcess !== proc) return;
        nextProcess = null;
        supervisor.crashed(() => {
            void bootServer(port, compileCacheDir).then((r) => {
                if (r.ready && answeredOnce) onRestarted?.(r.url);
            });
        });
    });

    // 1. Wait up to 30s for the TCP port to open. Polled at 50ms (was 200ms) — with
    //    preloadEntriesOnStart off (next.config.ts), the port now opens almost as soon
    //    as the process starts, so the old 200ms granularity was itself adding up to
    //    ~150ms of pure poll-interval slop to every boot for no reason.
    const url = `http://127.0.0.1:${port}`;
    let tcpReady = false;
    for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (await isPortListeningLocal(port, 200)) {
            tcpReady = true;
            break;
        }
    }

    if (!tcpReady) {
        console.error("[NextServer] TCP port did not open within timeout.");
        return { url, ready: false };
    }

    // 2. Ensure Next.js is actually answering HTTP requests without abort flooding.
    //    150ms between rounds (was 500ms): once the TCP port is open, a probe either
    //    answers or is refused almost immediately, so the old fixed 500ms mostly just
    //    sat idle between rounds instead of catching readiness sooner.
    const probeEndpoints = [`${url}/api/health`, `${url}/`];
    for (let attempt = 1; attempt <= 60; attempt++) {
        for (const probeUrl of probeEndpoints) {
            if (await isHttpReady(probeUrl, 3000)) {
                console.log(`[NextServer] Standalone server is HTTP ready on ${url} (verified via ${probeUrl})`);
                return { url, ready: true };
            }
        }
        await new Promise((r) => setTimeout(r, 150));
    }

    console.error("[NextServer] Server did not become HTTP ready within timeout.");
    return { url, ready: false };
}

/**
 * Fires background GET requests at a list of route paths so their entries compile
 * before staff actually navigate there.
 *
 * Only useful because next.config.ts turns off `preloadEntriesOnStart` for the
 * counter build: that flag used to eagerly compile all ~1300 route entries (pos,
 * office, vouchers, every api/* handler) before the server answered its first
 * request — measured ~7s of the app's ~15s cold start. Off, boot is fast but every
 * route pays its compile cost on its own first hit instead. Calling this right
 * after the login page has loaded (electron/main.ts) moves that cost into the few
 * seconds staff spend looking at / typing into the login screen — the compiles run
 * in that idle time and never end up in front of a spinner.
 *
 * Fire-and-forget: a warm miss just means that route compiles on its real first
 * visit instead, same as it would have without this at all.
 */
export function warmRoutes(baseUrl: string, routePaths: readonly string[]): void {
    for (const routePath of routePaths) {
        // Resolved against the origin rather than string-concatenated, and wrapped:
        // http.get() throws SYNCHRONOUSLY on a malformed URL, so a single bad entry used
        // to escape this loop and kill the main process with "A JavaScript error occurred
        // in the main process" — the opposite of the fire-and-forget contract above.
        // Warming is an optimisation; nothing here may ever be fatal.
        let target: string;
        try {
            const url = new URL(routePath, baseUrl);
            // A path that resolved off our own origin is not ours to warm.
            if (url.origin !== new URL(baseUrl).origin) {
                console.warn(`[NextServer] Skipping off-origin warm path: ${routePath}`);
                continue;
            }
            target = url.toString();
        } catch {
            console.warn(`[NextServer] Skipping unusable warm path: ${routePath}`);
            continue;
        }

        try {
            http.get(target, { timeout: 15000 }, (res) => {
                res.resume();
                console.log(`[NextServer] Warmed ${routePath} (${res.statusCode})`);
            }).on("error", (err) => {
                console.warn(`[NextServer] Warm request failed for ${routePath}:`, (err as Error).message);
            });
        } catch (err) {
            console.warn(`[NextServer] Warm request could not start for ${routePath}:`, (err as Error).message);
        }
    }
}

/**
 * Stops the forked Next.js server on app exit.
 *
 * Asks first, over the channel `fork` opens: the server stops its outbox flusher once
 * the batch on the wire has finished and answers (src/instrumentation.ts). On Windows
 * `kill()` is a hard TerminateProcess, so asking is the only way it finishes anything.
 * The process is ended after `graceMs` whether it answered or not.
 */
export async function stopNextServer(graceMs = 3000): Promise<void> {
    supervisor.reset();
    const proc = nextProcess;
    nextProcess = null;
    if (!proc || proc.killed || proc.exitCode !== null) return;
    console.log("[NextServer] Stopping Next.js server process...");
    if (proc.connected) {
        await new Promise<void>((resolve) => {
            const done = () => {
                clearTimeout(timer);
                proc.off("message", onMessage);
                proc.off("exit", done);
                resolve();
            };
            const onMessage = (msg: { type?: string } | null) => {
                if (msg?.type === "shutdown-done") done();
            };
            const timer = setTimeout(() => {
                console.warn(`[NextServer] No answer to shutdown within ${graceMs} ms — ending it.`);
                done();
            }, graceMs);
            proc.on("message", onMessage);
            proc.once("exit", done);
            try {
                proc.send({ type: "shutdown" });
            } catch {
                done();
            }
        });
    }
    try {
        if (proc.exitCode === null) proc.kill();
    } catch (err) {
        console.error("[NextServer] Error stopping server:", err);
    }
}
