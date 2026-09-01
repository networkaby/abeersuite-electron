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
        stdio: ["ignore", "pipe", "pipe"],
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
    });

    console.log("[HardwareBridge] Started.");
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
