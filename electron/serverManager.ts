import * as path from "path";
import * as net from "net";
import { app } from "electron";
import { fork, type ChildProcess } from "child_process";

import * as http from "http";

let nextProcess: ChildProcess | null = null;

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

    nextProcess = fork(serverScript, [], {
        cwd: standaloneDir,
        env: {
            ...process.env,
            PORT: String(port),
            // LAN-exposed on purpose: staff need to open a counter from another PC's
            // browser (http://<counter-ip>:<port>), and each counter's port is unique
            // (3000 + its EPBX extension, see main.ts resolvePort()) so counters on the
            // same shop LAN never collide. Login is still required at the app layer.
            HOSTNAME: "0.0.0.0",
            NODE_ENV: "production",
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

    // Pipe child stdout/stderr through console logger so it is recorded in main.log.
    nextProcess.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (text) console.log(`[NextServer] ${text}`);
    });
    nextProcess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (text) console.error(`[NextServer:err] ${text}`);
    });

    nextProcess.on("error", (err) => {
        console.error("[NextServer] Fork error:", err);
    });

    nextProcess.on("exit", (code, signal) => {
        console.log(`[NextServer] Process exited (code=${code}, signal=${signal}).`);
        nextProcess = null;
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
        const target = `${baseUrl}${routePath}`;
        http.get(target, { timeout: 15000 }, (res) => {
            res.resume();
            console.log(`[NextServer] Warmed ${routePath} (${res.statusCode})`);
        }).on("error", (err) => {
            console.warn(`[NextServer] Warm request failed for ${routePath}:`, (err as Error).message);
        });
    }
}

/**
 * Gracefully stops the forked Next.js server process on app exit.
 */
export function stopNextServer(): void {
    if (nextProcess && !nextProcess.killed) {
        console.log("[NextServer] Stopping Next.js server process...");
        try {
            nextProcess.kill();
        } catch (err) {
            console.error("[NextServer] Error stopping server:", err);
        }
        nextProcess = null;
    }
}
