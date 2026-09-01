"use client";

/**
 * This PC's identity for counter device-locking (`PosCounter.boundDeviceId`).
 *
 * Historically the ONLY id was minted by the renderer and stored in the local bridge's
 * `config.json` (see ShiftOpenDialog) — random, and gone the moment the bridge is
 * retired. Electron already keeps a better one: `COUNTER-<uuid>`, persisted in
 * `%APPDATA%/abeersuite-electron/counter-installation-id.json`, independent of any
 * second local service running. That is now canonical.
 *
 * The bridge id is still read here, best-effort, purely to recognise a counter that
 * was bound under the old scheme so it can be migrated rather than refused — see the
 * lock-check in POST /api/pos/shifts. Once every counter has rebound to its Electron
 * id this whole legacy half can be deleted.
 */

import { isElectronEnvironment, getCounterInstallationId } from "@/shared/lib/bridge/bridgeHealth";

import { bridgeRequest } from "@/shared/lib/bridge/hardwareBridge";

export interface MachineIdentity {
    /** Canonical id — bind and match against this going forward. */
    machineId: string | null;
    /** The old bridge-minted id, if the bridge is running and already has one. */
    legacyDeviceId: string | null;
    /** Friendly label for the admin counter list, sourced from the bridge's config. */
    deviceLabel: string | null;
}

async function readBridgeConfig(mintIfMissing: boolean): Promise<{ deviceId: string | null; companyName: string | null }> {
    try {
        const cfg = await bridgeRequest<{ deviceId?: string | null; companyName?: string | null }>(
            "thermal", "config:get", undefined, 2000);
        if (cfg.deviceId) return { deviceId: cfg.deviceId, companyName: cfg.companyName ?? null };
        if (!mintIfMissing) return { deviceId: null, companyName: cfg.companyName ?? null };
        // Bridge-only machine, no id yet — mint one and persist it, same as before.
        const id = crypto.randomUUID();
        void bridgeRequest("thermal", "config:set", { deviceId: id })
            .catch(() => { /* offline — id just won't persist */ });
        return { deviceId: id, companyName: cfg.companyName ?? null };
    } catch {
        return { deviceId: null, companyName: null };
    }
}

/**
 * Resolves this PC's identity for counter binding.
 *
 * On Electron: `machineId` is the Electron installation id (never minted into the
 * bridge — Electron owns it); `legacyDeviceId` is read, never written, purely to spot
 * a pre-existing binding from before this PC had Electron.
 *
 * Off Electron (bridge-only machine): unchanged from before — the bridge's own id is
 * both the canonical and legacy id, minted on first use if the bridge doesn't have one.
 */
export async function resolveMachineIdentity(): Promise<MachineIdentity> {
    if (isElectronEnvironment()) {
        const [machineId, bridge] = await Promise.all([
            getCounterInstallationId(),
            readBridgeConfig(false),
        ]);
        return { machineId, legacyDeviceId: bridge.deviceId, deviceLabel: bridge.companyName };
    }
    const bridge = await readBridgeConfig(true);
    return { machineId: bridge.deviceId, legacyDeviceId: null, deviceLabel: bridge.companyName };
}

/** True if `boundDeviceId` matches this PC under either the canonical or legacy id. */
export function matchesThisMachine(boundDeviceId: string | null, identity: Pick<MachineIdentity, "machineId" | "legacyDeviceId">): boolean {
    if (!boundDeviceId) return false;
    return boundDeviceId === identity.machineId || boundDeviceId === identity.legacyDeviceId;
}
