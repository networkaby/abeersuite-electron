import * as path from "path";
import * as net from "net";
import { app } from "electron";
import { fork, type ChildProcess } from "child_process";

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
function isPortListeningLocal(port: number, timeoutMs = 1000): Promise<boolean> {
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
 * Starts the Next.js production server by forking the standalone `server.js`
 * that `next build` (with `output: "standalone"`) produced.
 *
 * In dev mode (NODE_ENV=development or unpackaged) the dev server is expected
 * to already be running — we just return the URL and skip spawning.
 */
export async function startNextServer(port = 3000): Promise<ServerStartResult> {
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
        },
        stdio: "pipe",
    });

    // Pipe child stdout/stderr to the main process console for debugging.
    nextProcess.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[NextServer] ${chunk.toString()}`);
    });
    nextProcess.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[NextServer:err] ${chunk.toString()}`);
    });

    nextProcess.on("error", (err) => {
        console.error("[NextServer] Fork error:", err);
    });

    nextProcess.on("exit", (code, signal) => {
        console.log(`[NextServer] Process exited (code=${code}, signal=${signal}).`);
        nextProcess = null;
    });

    // Wait up to 15 seconds for the server to become ready.
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await isPortListeningLocal(port, 200)) {
            console.log(`[NextServer] Standalone server is ready on ${url}`);
            return { url, ready: true };
        }
    }

    console.error("[NextServer] Server did not become ready within timeout.");
    return { url, ready: false };
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
