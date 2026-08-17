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
 * The origin used to be copy-pasted into every caller (ShiftOpenDialog, PosScreen,
 * PrintToolbar, printer-settings). New callers import it from here.
 *
 * Note the probe fails loudly in the browser console on a non-counter machine —
 * a refused connection to localhost is logged by the browser itself and cannot be
 * suppressed. That is expected, not a fault.
 */

export const BRIDGE_ORIGIN = "http://localhost:9191";

/** Long enough for a local service to answer, short enough not to stall a page. */
const PROBE_TIMEOUT_MS = 1000;

/** Shared across callers so one page load costs one probe, not one per component. */
let inflight: Promise<boolean> | null = null;

/**
 * Is the bridge answering on this machine?
 *
 * Memoised for the life of the page: the answer is a property of the machine, not
 * of the moment, and every caller in a render pass should get the same one. Pass
 * `refresh` after the user has been told to start the service, so a bridge that
 * came up late is picked up without a reload.
 */
export function isBridgeAvailable({ refresh = false }: { refresh?: boolean } = {}): Promise<boolean> {
    if (refresh) inflight = null;
    inflight ??= fetch(`${BRIDGE_ORIGIN}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        .then((r) => r.ok)
        .catch(() => false);
    return inflight;
}
