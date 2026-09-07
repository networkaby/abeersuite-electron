"use client";

/**
 * One client for the shop hardware — thermal printer and DQ11 customer display —
 * over whichever transport this machine has.
 *
 * **In Electron** — commands go over IPC (preload `electronAPI.bridge` → main →
 * hardware-bridge/{thermal,qr}.js). The bundled bridge has no HTTP port: that shape was
 * inherited from the standalone combined-bridge, back when the app ran in a plain
 * browser and HTTP was the only way to reach a local process. Inside Electron it only
 * left the printer and display drivable by anything that could reach the port.
 *
 * **In a browser** — falls back to the standalone combined-bridge on :9191 / :9192,
 * exactly as the app worked before Electron absorbed it. Note this reaches the bridge on
 * the BROWSER's own PC, never the counter's: an admin opening a counter from their desk
 * drives their own printer, which is the design the combined bridge always had — every
 * PC its own bridge, its own hardware. With no combined-bridge install on that PC there
 * is nothing to reach.
 *
 * Chosen per call from `window.electronAPI`, so there is no flag to set and nothing to
 * rebuild — a browser simply never has it. Command names deliberately mirror the old
 * HTTP paths so one small `switch` covers the fallback.
 */

import { isElectronEnvironment } from "./electronEnv";

export type BridgeModule = "qr" | "thermal";

/** Ports of a standalone combined-bridge install — the browser fallback only. */
const ORIGIN: Record<BridgeModule, string> = {
    thermal: "http://localhost:9191",
    qr:      "http://localhost:9192",
};

type BridgeReply = { ok: boolean; result?: unknown; error?: string };

type BridgeApi = {
    bridge?: {
        send:    (mod: BridgeModule, cmd: string, payload?: unknown) => void;
        request: (mod: BridgeModule, cmd: string, payload?: unknown) => Promise<BridgeReply>;
    };
};

function api(): BridgeApi["bridge"] | undefined {
    if (!isElectronEnvironment()) return undefined;
    return (window as unknown as { electronAPI?: BridgeApi }).electronAPI?.bridge;
}

/** Command → the HTTP shape a standalone combined-bridge expects. */
function httpShape(cmd: string): { method: "GET" | "POST"; path: string } {
    switch (cmd) {
        case "health":     return { method: "GET",  path: "/health"   };
        case "config:get": return { method: "GET",  path: "/config"   };
        case "config:set": return { method: "POST", path: "/config"   };
        case "ports":      return { method: "GET",  path: "/ports"    };
        case "printers":   return { method: "GET",  path: "/printers" };
        // The rest — print/pos, pos/cart, idle/start, clear … — are POSTs whose path is
        // the command itself.
        default:           return { method: "POST", path: `/${cmd}` };
    }
}

function httpCall(mod: BridgeModule, cmd: string, payload: unknown, timeoutMs: number): Promise<Response> {
    const { method, path } = httpShape(cmd);
    return fetch(`${ORIGIN[mod]}${path}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body:    method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
        signal:  AbortSignal.timeout(timeoutMs),
        credentials: "omit",
        cache:       "no-store",
    });
}

/**
 * Fire-and-forget. Never throws, never reports — only for commands whose failure must
 * not reach the cashier. That is the QR display, not printing.
 */
export function bridgeSend(mod: BridgeModule, cmd: string, payload?: unknown): void {
    try {
        const a = api();
        if (a) return a.send(mod, cmd, payload);
        void httpCall(mod, cmd, payload, 2000).catch(() => {});
    } catch {
        // Bridge unreachable — silent, by contract.
    }
}

/**
 * Command that needs an answer. **Throws** on failure, so the caller can tell the user.
 *
 * The default timeout is generous because printing is in here: a network printer that is
 * asleep, out of paper, or on a slow COM port can take several seconds to fail, and
 * timing out early would report "failed" for a receipt that then prints anyway.
 */
export async function bridgeRequest<T>(mod: BridgeModule, cmd: string, payload?: unknown, timeoutMs = 15_000): Promise<T> {
    const a = api();
    if (a) {
        const reply = await a.request(mod, cmd, payload);
        if (!reply?.ok) throw new Error(reply?.error || `"${cmd}" failed.`);
        return reply.result as T;
    }

    const r = await httpCall(mod, cmd, payload, timeoutMs);
    if (!r.ok) {
        // The bridge answers errors as { error }, but something else on the port may not
        // return JSON at all — never let the parse failure mask the real status.
        const detail = await r.json().catch(() => null);
        throw new Error(detail?.error || `"${cmd}" failed (HTTP ${r.status}).`);
    }
    return (await r.json()) as T;
}

/** Probe that never throws — for "is the hardware there?" checks. */
export async function bridgeOk(mod: BridgeModule, timeoutMs = 2000): Promise<boolean> {
    try {
        await bridgeRequest(mod, "health", undefined, timeoutMs);
        return true;
    } catch {
        return false;
    }
}

/** True when Printer Settings names a thermal printer of any type (LAN ip /
 *  COM port / Windows printer) for the chosen connection. Blank → the counter
 *  has no thermal printer, so nothing may print silently (print rule, point 4). */
export async function thermalPrinterConfigured(): Promise<boolean> {
    try {
        const cfg = await bridgeRequest<{ connectionType?: string; printerIp?: string; comPort?: string; windowsPrinterName?: string }>("thermal", "config:get", undefined, 1500);
        switch (cfg?.connectionType) {
            case "com":     return !!cfg.comPort?.trim();
            case "windows": return !!cfg.windowsPrinterName?.trim();
            default:        return !!cfg?.printerIp?.trim();
        }
    } catch {
        return false;
    }
}
