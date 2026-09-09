"use client";

import { useSyncExternalStore } from "react";

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

/**
 * The same answer, for a component that renders differently inside the desktop app.
 *
 * A component cannot simply call `isElectronEnvironment()` while rendering: the server
 * has no `window.electronAPI`, so the first client paint would disagree with the HTML
 * it is hydrating. The old way round that was a `useState(false)` filled in by an
 * effect, which is a re-render every mount and reads as if the value could change.
 *
 * It cannot. The preload script sets `electronAPI` before any of our code runs, so this
 * is a fixed fact about where the page is — an outside fact, which is exactly what
 * `useSyncExternalStore` is for. Nothing ever changes it, so nothing needs subscribing
 * to; React just reads `false` on the server and the real answer on the client.
 */
const noElectronChanges = () => () => { /* it cannot change while the page is open */ };
const notElectronOnServer = () => false;

export function useIsDesktopApp(): boolean {
    return useSyncExternalStore(noElectronChanges, isElectronEnvironment, notElectronOnServer);
}
