import * as path from "path";
import * as net from "net";
import { app } from "electron";
import { fork, type ChildProcess } from "child_process";

let nextProcess: ChildProcess | null = null;

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
export async function startNextServer(port = 3000): Promise<string> {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    if (isDev) {
        return `http://localhost:${port}`;
    }

    // If something is already listening (e.g. previous instance), reuse it.
    if (await isPortListeningLocal(port, 300)) {
        console.log(`[NextServer] Detected server already listening on port ${port}.`);
        return `http://localhost:${port}`;
    }

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
            // Loopback only. "0.0.0.0" would publish the POS on the shop wifi, letting
            // anyone on the network open http://<counter-ip>:3000 unauthenticated at the
            // network layer. Only this Electron window needs to reach the server.
            HOSTNAME: "127.0.0.1",
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
    for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await isPortListeningLocal(port, 200)) {
            console.log(`[NextServer] Standalone server is ready on http://localhost:${port}`);
            return `http://localhost:${port}`;
        }
    }

    console.warn("[NextServer] Server did not become ready within timeout. Continuing anyway.");
    return `http://localhost:${port}`;
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
