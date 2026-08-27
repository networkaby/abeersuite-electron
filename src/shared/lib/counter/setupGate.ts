"use client";

/**
 * First-launch counter setup — reconciliation between the local `counter.json`
 * (written once by /setup/counter, read back by Electron's `counter:get-setup`)
 * and the server's current PosCounter row.
 *
 * ── Why check at all, rather than trust the local file forever ──────────────
 * An admin can release a counter from /office/admin/counters at any time, which
 * clears its counterNumber/idRangeStart centrally. A machine that already
 * completed setup has no other way to learn that happened — it would otherwise
 * keep believing it holds a confirmed, safe id range it no longer actually owns.
 *
 * ── Why "trust it" is still the right default when offline ──────────────────
 * This machine cannot always reach the server to ask. Every other readiness
 * check in this codebase degrades gracefully rather than blocking the cashier —
 * this one does too: unreachable means "proceed on the local file", not "refuse
 * to boot". The check only ever *invalidates* something on a POSITIVE
 * confirmation that it was released; it never invalidates on mere silence.
 *
 * ── Reassignment is not the same as release ──────────────────────────────────
 * An admin can also REBIND this device to a different counter row rather than
 * releasing it outright (boundDeviceId moved from counter A to counter B). The
 * old check — "does my counterId still carry my counterNumber" — is blind to
 * this: counter A's own number never changed, so it would keep reporting
 * "valid" while this PC is actually now sitting on counter B. Resolving this
 * device's *actual* bound counter (same device-identity match
 * useMyCounterExtension uses) catches that and updates the local cache in
 * place, rather than forcing a manual re-setup for a change the server already
 * knows about.
 */

import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { resolveMachineIdentity, matchesThisMachine } from "@/shared/lib/counter/identity";

export type ReconcileResult = "valid" | "reassigned" | "released" | "unreachable" | "not-set-up";

interface CounterListEntry {
    id: number;
    counterNumber: number | null;
    boundDeviceId: string | null;
}

export async function getLocalCounterSetup(): Promise<{ counterId: number; counterNumber: number } | null> {
    if (!isElectronEnvironment() || !window.electronAPI?.getCounterSetup) return null;
    return window.electronAPI.getCounterSetup();
}

/**
 * Confirms the local setup still matches the server. Never throws — a network
 * failure resolves to "unreachable", not an error the caller has to catch.
 */
export async function reconcileCounterSetup(): Promise<ReconcileResult> {
    const local = await getLocalCounterSetup();
    if (!local) return "not-set-up";

    try {
        const [identity, res] = await Promise.all([
            resolveMachineIdentity(),
            fetch("/api/pos/counters?scope=all", { cache: "no-store" }),
        ]);
        if (!res.ok) return "unreachable";
        // No identity to match against (bridge/Electron id not resolved yet) —
        // cannot tell "released" from "just can't check right now", so don't
        // guess. Treat the same as a network failure: trust the local file.
        if (!identity.machineId && !identity.legacyDeviceId) return "unreachable";
        const counters: CounterListEntry[] = await res.json();

        // Which counter is THIS device actually bound to, right now, per the
        // server — independent of what the local cache says.
        const bound = counters.find((c) => matchesThisMachine(c.boundDeviceId, identity));
        if (!bound || bound.counterNumber === null) return "released";

        if (bound.id !== local.counterId || bound.counterNumber !== local.counterNumber) {
            // Rebound to a different counter (or the same counter's number
            // changed) — update the local cache/title in place rather than
            // forcing a re-setup flow for something the server already knows.
            await window.electronAPI?.saveCounterSetup?.({ counterId: bound.id, counterNumber: bound.counterNumber });
            return "reassigned";
        }
        return "valid";
    } catch {
        return "unreachable";
    }
}
