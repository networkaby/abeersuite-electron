"use client";

/**
 * The counter bridge — the local service installed on shop machines that drives
 * the thermal printer and the customer QR display.
 *
 * Its presence is also what marks this browser as a COUNTER rather than someone's
 * laptop, which is how the Day Book decides whether it may keep a copy of the
 * books on this disk. A managed shop machine caches; anything else stays live-only
 * and writes nothing locally.
 *
 * Commands go through `hardwareBridge.ts` (IPC in Electron, HTTP to a standalone
 * combined-bridge from a browser). This file keeps only the "is there a counter here?"
 * question, which several unrelated features ask.
 *
 * Note the probe fails loudly in the browser console on a non-counter machine —
 * a refused connection to localhost is logged by the browser itself and cannot be
 * suppressed. That is expected, not a fault.
 */

import { bridgeOk } from "./hardwareBridge";
import { isElectronEnvironment } from "./electronEnv";
// Re-exported: this was its home before hardwareBridge needed it too, and plenty of
// callers still import it from here.
export { isElectronEnvironment };

/** Long enough for a local service to answer, short enough not to stall a page. */
const PROBE_TIMEOUT_MS = 1000;

/** Shared across callers so one page load costs one probe, not one per component. */
let inflight: Promise<boolean> | null = null;


/**
 * Returns the persistent unique counter machine installation ID if running in Electron.
 */
export async function getCounterInstallationId(): Promise<string | null> {
    if (typeof window !== "undefined") {
        const api = (window as unknown as { electronAPI?: { getCounterId?: () => Promise<string> } }).electronAPI;
        if (api?.getCounterId) {
            try {
                return await api.getCounterId();
            } catch {
                return null;
            }
        }
    }
    return null;
}

/**
 * Is the counter/bridge answering on this machine?
 * In Electron, it resolves to true immediately without external network probes.
 */
export function isBridgeAvailable({ refresh = false }: { refresh?: boolean } = {}): Promise<boolean> {
    if (isElectronEnvironment()) {
        return Promise.resolve(true);
    }
    if (refresh) inflight = null;
    inflight ??= bridgeOk("thermal", PROBE_TIMEOUT_MS);
    return inflight;
}

