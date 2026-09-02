"use client";

/**
 * This PC's identity for counter device-locking (`PosCounter.boundDeviceId`).
 *
 * One id per app version, and they are never cross-matched (owner rule):
 *
 *   - Desktop app (Electron): `COUNTER-<uuid>`, persisted in
 *     `%APPDATA%/abeersuite-electron/counter-installation-id.json`.
 *   - Web version with the local hardware bridge: the bridge's own id from its
 *     `config.json`, minted on first use.
 *
 * A counter bound under one id is simply "in use by another PC" to the other version —
 * even on the same physical machine. Release first, then onboard. There is no
 * migration path and no legacy lookup: the bridge id used to be read on Electron too,
 * to recognise and silently rebind a counter from before this PC had Electron; that is
 * gone, because binding now happens in onboarding only.
 */

import { isElectronEnvironment, getCounterInstallationId } from "@/shared/lib/bridge/bridgeHealth";

import { bridgeRequest } from "@/shared/lib/bridge/hardwareBridge";

export interface MachineIdentity {
    /** This version's id for this PC — bind and match against this, nothing else. */
    machineId: string | null;
    /** Friendly label for the admin counter list, sourced from the bridge's config. */
    deviceLabel: string | null;
}

async function readBridgeConfig(mintIfMissing: boolean): Promise<{ deviceId: string | null; companyName: string | null }> {
    try {
        const cfg = await bridgeRequest<{ deviceId?: string | null; companyName?: string | null }>(
            "thermal", "config:get", undefined, 2000);
        if (cfg.deviceId) return { deviceId: cfg.deviceId, companyName: cfg.companyName ?? null };
        if (!mintIfMissing) return { deviceId: null, companyName: cfg.companyName ?? null };
        // Bridge-only machine, no id yet — mint one and persist it.
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
 * On Electron the id is the installation id; the bridge is consulted only for the
 * friendly label, never for an id. Off Electron the bridge's id is the identity.
 */
export async function resolveMachineIdentity(): Promise<MachineIdentity> {
    if (isElectronEnvironment()) {
        const [machineId, bridge] = await Promise.all([
            getCounterInstallationId(),
            readBridgeConfig(false),
        ]);
        return { machineId, deviceLabel: bridge.companyName };
    }
    const bridge = await readBridgeConfig(true);
    return { machineId: bridge.deviceId, deviceLabel: bridge.companyName };
}

/** True if `boundDeviceId` is this PC under this version's id. */
export function matchesThisMachine(boundDeviceId: string | null, identity: Pick<MachineIdentity, "machineId">): boolean {
    return !!boundDeviceId && boundDeviceId === identity.machineId;
}
