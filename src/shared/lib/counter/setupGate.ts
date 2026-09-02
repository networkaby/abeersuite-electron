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
 * ── Asked of the replica, never of the cloud ────────────────────────────────
 * `/api/pos/counters/my-binding` reads this PC's binding from the replica. The replica
 * is kept honest by the sync worker (Realtime signal + interval safety net), so an
 * admin's release reaches it a cycle late at most, and the reconciler re-asks exactly
 * when a pull touched PosCounter. No timer, no authoritative read, no egress. A replica
 * that is not ready yet (before its first pull, or mid-wipe) resolves to `unreachable`,
 * so the trust-the-local-file rule above is intact.
 *
 * ── Login runs the same check ───────────────────────────────────────────────
 * Signing in on a bound PC asks the replica once, offline or online. A PC with no
 * local file never gets this far: it is sent to the wizard, which binds online only.
 *
 * ── No reassignment ─────────────────────────────────────────────────────────
 * A counter must be released before any PC can onboard on it, and binding happens in
 * onboarding only. So the only question is "does the file's counter still carry this
 * PC's id": yes → in, no → not bound → clean → onboard again. There is nothing to heal
 * in place.
 */

import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { resolveMachineIdentity } from "@/shared/lib/counter/identity";

/**
 * `valid`       — the replica's row for the file's counter still carries this PC.
 * `released`    — a ready replica says it does not. Clean and onboard again.
 * `unreachable` — the replica could not answer (not ready, ambiguous). Keep the file;
 *                 the readiness gate keeps the app covered while that lasts.
 * `not-set-up`  — no local file. Onboarding.
 *
 * There is no "reassigned": a counter must be released before any PC can onboard on
 * it, so a file that names counter A while the DB binds this PC to counter B is simply
 * not bound — same outcome as released.
 */
export type ReconcileResult = "valid" | "released" | "unreachable" | "not-set-up";

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
 * The live shift on the counter this PC holds, as the replica sees it. Null when there
 * is none, or when the replica could not answer — the caller must not read "no shift"
 * into silence, so this is only ever acted on alongside a `valid` reconcile.
 */
let lastOpenShift: BoundShift | null = null;
export function lastKnownOpenShift(): BoundShift | null { return lastOpenShift; }

export async function getLocalCounterSetup(): Promise<{ counterId: number; counterNumber: number } | null> {
    if (!isElectronEnvironment() || !window.electronAPI?.getCounterSetup) return null;
    return window.electronAPI.getCounterSetup();
}

/**
 * The web version's counter check: is the local bridge's id bound to a counter in the
 * DB? There is no local file off Electron, so this is the whole test. False when the
 * bridge is absent, has no id, or the DB cannot be reached — a browser with no
 * counter falls to the "login outside counter" permission gate.
 */
export async function isWebCounterBound(): Promise<boolean> {
    if (isElectronEnvironment()) return false;
    try {
        const identity = await resolveMachineIdentity();
        if (!identity.machineId) return false;
        const qs = new URLSearchParams({ deviceId: identity.machineId, authoritative: "1" });
        const res = await fetch(`/api/pos/counters/my-binding?${qs}`, { cache: "no-store" });
        if (!res.ok) return false;
        const body: MyBindingResponse = await res.json();
        return body.reachable && !!body.counter;
    } catch {
        return false;
    }
}

/**
 * Confirms the local setup still matches the server. Never throws — a network
 * failure resolves to "unreachable", not an error the caller has to catch.
 */
export async function reconcileCounterSetup(authoritative = false): Promise<ReconcileResult> {
    const local = await getLocalCounterSetup();
    if (!local) return "not-set-up";

    try {
        const identity = await resolveMachineIdentity();
        // No identity to match against (Electron id not resolved yet) — cannot tell
        // "released" from "just can't check right now", so don't guess. Treat the
        // same as a network failure: trust the local file.
        if (!identity.machineId) return "unreachable";

        const qs = new URLSearchParams({ deviceId: identity.machineId });
        // Online, ask the DB itself: one row read per login, and a released counter is
        // caught at sign-in rather than on the next pull. Offline, the replica answers.
        if (authoritative && typeof navigator !== "undefined" && navigator.onLine) qs.set("authoritative", "1");

        const res = await fetch(`/api/pos/counters/my-binding?${qs}`, { cache: "no-store" });
        if (!res.ok) return "unreachable";
        const body: MyBindingResponse = await res.json();
        // The replica could not answer (not ready, or ambiguous) — silence, not a release.
        if (!body.reachable) return "unreachable";

        // Which counter is THIS device actually bound to, per the replica —
        // independent of what the local cache says. The BINDING is the whole signal.
        if (!body.counter || body.counter.id !== local.counterId) { lastOpenShift = null; return "released"; }
        lastOpenShift = body.openShift ?? null;
        return "valid";
    } catch {
        return "unreachable";
    }
}
