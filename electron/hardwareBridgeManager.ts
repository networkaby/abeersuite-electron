/**
 * Supervises the shop-hardware bridge (`hardware-bridge/`), which drives the thermal
 * printer on loopback :9191.
 *
 * Same arrangement, and the same reasoning, as `syncManager.ts`: the code moved in
 * wholesale from the separate `combined-bridge` service rather than being rewritten, and
 * runs as a child process so a wedged printer or a stuck COM port cannot take the POS
 * window down with it. See `hardware-bridge/index.js` for why it still speaks HTTP on
 * the port the renderer already knows.
 *
 * The QR display half (:9192, the DQ11 customer-facing panel) lives here too — see
 * `hardware-bridge/qr.js`, started alongside thermal by `index.js`. Both relays bind
 * loopback only and check the request Origin; they are not reachable from the LAN.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";

let bridge: ChildProcess | null = null;

/** Mirrors the dev/packaged split used by the other managers. */
function bridgeDir(): string {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    return isDev
        ? path.join(process.cwd(), "hardware-bridge")
        : path.join(process.resourcesPath, "hardware-bridge");
}

function configFilePath(): string {
    return path.join(app.getPath("userData"), "hardware-bridge.json");
}

/**
 * Starts the bridge. Never throws and never blocks boot — a counter with no printer
 * bridge still sells, it just cannot print, and the app already degrades for that:
 * `PosScreen.tsx` probes `/health` before offering a thermal receipt.
 */
export function startHardwareBridge(): void {
    if (bridge) return;

    const dir = bridgeDir();
    const entry = path.join(dir, "index.js");
    if (!fs.existsSync(entry)) {
        console.error(`[HardwareBridge] Not found at ${entry} — thermal printing is unavailable.`);
        return;
    }

    // Config is created on first use by the settings page (POST /config); an absent file
    // is a fresh machine, not an error. Touching it here only so the path exists.
    const configFile = configFilePath();

    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so no separate
    // Node runtime has to be installed on the counter.
    bridge = spawn(process.execPath, [entry], {
        cwd: dir,
        // The 4th slot opens the IPC channel the QR display is driven over — see
        // `sendQr`/`requestQr` below and the COMMANDS table in hardware-bridge/qr.js.
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            HARDWARE_BRIDGE_CONFIG: configFile,
            HARDWARE_BRIDGE_VERSION: app.getVersion(),
        },
    });

    const relay = (buf: Buffer) => {
        for (const line of String(buf).split("\n")) {
            if (line.trim()) console.log(`[bridge] ${line.trimEnd()}`);
        }
    };
    resetQrReady();
    attachQrReplyRouter(bridge);

    bridge.stdout?.on("data", relay);
    bridge.stderr?.on("data", relay);

    bridge.on("error", (err) => {
        console.error("[HardwareBridge] Failed to start:", err);
        bridge = null;
    });

    bridge.on("exit", (code, sig) => {
        // Not restarted automatically. The commonest reason to exit is EADDRINUSE — an
        // OLD standalone combined-bridge install still holding :9191 — and a restart loop
        // would spin forever against it while burying the one log line that explains it.
        console.log(`[HardwareBridge] Exited (code ${code}, signal ${sig}).`);
        bridge = null;
        // Nothing will ever answer these now — reject rather than let the settings page
        // sit on a promise until its own timeout.
        for (const [id, slot] of pending) {
            clearTimeout(slot.timer);
            slot.reject(new Error("Display bridge exited."));
            pending.delete(id);
        }
    });

    console.log("[HardwareBridge] Started.");
}

/**
 * Pending `requestQr` calls, keyed by correlation id.
 *
 * Only the four settings-page commands (health, config:get, config:set, ports) ever
 * land here — the eight POS screen commands are fire-and-forget and never allocate an
 * entry. A wedged display therefore cannot grow this map during a sale.
 */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let nextRequestId = 1;

/**
 * Resolves when qr.js has registered its message handler.
 *
 * Loading sharp + serialport takes a second or two, and Node drops a message that
 * arrives before a `message` listener exists — no listener, no queue, no error. Without
 * this gate a command sent during boot vanishes and the caller just waits out its
 * timeout. Reset on every spawn.
 */
let qrReady: Promise<void> = Promise.resolve();
let markQrReady: () => void = () => {};

function resetQrReady(): void {
    qrReady = new Promise<void>((resolve) => { markQrReady = resolve; });
}

function attachQrReplyRouter(child: ChildProcess): void {
    child.on("message", (msg: unknown) => {
        const m = msg as { mod?: string; ready?: boolean; id?: number; result?: unknown; error?: string };
        if (!m || m.mod !== "qr") return;
        if (m.ready) return markQrReady();
        if (typeof m.id !== "number") return;
        const slot = pending.get(m.id);
        if (!slot) return; // Already timed out — the late reply is nothing to act on.
        pending.delete(m.id);
        clearTimeout(slot.timer);
        if (m.error) slot.reject(new Error(m.error));
        else slot.resolve(m.result);
    });
}

/** True when the bridge child is alive and its IPC channel is open. */
export function isBridgeConnected(): boolean {
    return Boolean(bridge && bridge.connected);
}

/**
 * Fire-and-forget QR display command. Never throws: the display is best-effort by
 * contract (see `qrDisplay.ts` — a failure must never reach the cashier), and a counter
 * with no DQ11 attached is an ordinary configuration, not a fault.
 */
export function sendQr(cmd: string, payload?: unknown): void {
    if (!bridge?.connected) return;
    void qrReady.then(() => {
        if (!bridge?.connected) return;
        try {
            bridge.send({ mod: "qr", cmd, payload });
        } catch (err) {
            console.error(`[HardwareBridge] qr ${cmd} failed:`, err);
        }
    });
}

/**
 * QR display command that needs an answer (settings page only). Rejects rather than
 * hanging if the bridge is down or the child stops replying — the old HTTP client had
 * an AbortSignal.timeout for the same reason.
 */
export function requestQr(cmd: string, payload?: unknown, timeoutMs = 8000): Promise<unknown> {
    if (!bridge?.connected) return Promise.reject(new Error("Display bridge is not running."));
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
        // Timer starts now, not after the ready gate: the caller cares about total wait,
        // and a bridge that never becomes ready must fail rather than hang the page.
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Display bridge did not answer "${cmd}" within ${timeoutMs}ms.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        void qrReady.then(() => {
            if (!pending.has(id)) return; // Already timed out.
            try {
                bridge!.send({ mod: "qr", cmd, payload, id });
            } catch (err) {
                pending.delete(id);
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    });
}

export function stopHardwareBridge(): void {
    if (!bridge || bridge.killed) return;
    console.log("[HardwareBridge] Stopping…");
    try {
        bridge.kill();
    } catch (err) {
        console.error("[HardwareBridge] Error stopping:", err);
    }
    bridge = null;
}
