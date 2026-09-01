"use client";

/**
 * Is this page running inside the Electron shell?
 *
 * Its own module so `bridgeHealth.ts` and `hardwareBridge.ts` can both use it without
 * importing each other — bridgeHealth probes THROUGH hardwareBridge, and hardwareBridge
 * needs this check to pick its transport, which would otherwise be a cycle.
 *
 * This is also the whole transport switch: a browser never has `electronAPI`, so the
 * hardware clients fall back to a standalone combined-bridge with no flag to set and
 * nothing to rebuild.
 */
export function isElectronEnvironment(): boolean {
    return typeof window !== "undefined"
        && Boolean((window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron);
}
