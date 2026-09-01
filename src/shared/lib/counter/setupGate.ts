"use client";

/**
 * First-launch counter setup — reconciliation between the local `counter.json`
 * (written once by /setup/counter, read back by Electron's `counter:get-setup`)
 * and the server's current PosCounter row.
 *
 * ── Why check at all, rather than trust the local file forever ──────────────
 * An admin can release a counter from /office/admin/counters at any time, which
 * clears its device binding centrally. A machine that already completed setup has
 * no other way to learn that happened — it would otherwise keep billing as a
 * counter it no longer holds.
 *
 * ── Why "trust it" is still the right default when offline ──────────────────
 * This machine cannot always reach the server to ask. Every other readiness
 * check in this codebase degrades gracefully rather than blocking the cashier —
 * this one does too: unreachable means "proceed on the local file", not "refuse
 * to boot". The check only ever *invalidates* something on a POSITIVE
 * confirmation that it was released; it never invalidates on mere silence.
 *
 * ── Asked of the DB, not of the counter's own replica ───────────────────────
 * This used to fetch the whole counter list, which is served through `prisma` — the
 * replica on a counter PC. The row it consulted is the one this same machine stamps
 * at shift open, so the check was circular: an admin's release only surfaced after a
 * pull, and never while the machine was offline. It now asks
 * `/api/pos/counters/my-binding`, which reads authoritatively. "Cannot reach the DB"
 * still resolves to `unreachable`, so the trust-the-local-file rule above is intact.
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
import { resolveMachineIdentity } from "@/shared/lib/counter/identity";

export type ReconcileResult = "valid" | "reassigned" | "released" | "unreachable" | "not-set-up";

/** The counter's live shift as the DB sees it — null when there is none. */
export interface BoundShift {
    id: number;
    status: "OPEN" | "AWAITING_HANDOVER";
    userId: number;
}

interface MyBindingResponse {
    reachable: boolean;
    counter: { id: number; counterNumber: number; name: string } | null;
    openShift?: BoundShift | null;
}

/**
 * The live shift on the counter this PC holds, straight from the DB. Null when there
 * is none, or when the DB could not be reached — the caller must not read "no shift"
 * into silence, so this is only ever acted on alongside a `valid` reconcile.
 */
let lastOpenShift: BoundShift | null = null;
export function lastKnownOpenShift(): BoundShift | null { return lastOpenShift; }

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
        const identity = await resolveMachineIdentity();
        // No identity to match against (bridge/Electron id not resolved yet) —
        // cannot tell "released" from "just can't check right now", so don't
        // guess. Treat the same as a network failure: trust the local file.
        if (!identity.machineId && !identity.legacyDeviceId) return "unreachable";

        const qs = new URLSearchParams();
        if (identity.machineId) qs.set("deviceId", identity.machineId);
        if (identity.legacyDeviceId) qs.set("legacyDeviceId", identity.legacyDeviceId);

        const res = await fetch(`/api/pos/counters/my-binding?${qs}`, { cache: "no-store" });
        if (!res.ok) return "unreachable";
        const body: MyBindingResponse = await res.json();
        // The DB could not be reached — silence, not a release.
        if (!body.reachable) return "unreachable";

        // Which counter is THIS device actually bound to, right now, per the DB —
        // independent of what the local cache says. The BINDING is the whole signal.
        if (!body.counter) { lastOpenShift = null; return "released"; }
        lastOpenShift = body.openShift ?? null;

        if (body.counter.id !== local.counterId || body.counter.counterNumber !== local.counterNumber) {
            // Rebound to a different counter (or the same counter's number
            // changed) — update the local cache/title in place rather than
            // forcing a re-setup flow for something the server already knows.
            await window.electronAPI?.saveCounterSetup?.({ counterId: body.counter.id, counterNumber: body.counter.counterNumber });
            return "reassigned";
        }
        return "valid";
    } catch {
        return "unreachable";
    }
}
