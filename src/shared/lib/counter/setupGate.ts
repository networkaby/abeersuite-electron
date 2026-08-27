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
 */

import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";

export type ReconcileResult = "valid" | "released" | "unreachable" | "not-set-up";

interface CounterListEntry {
    id: number;
    counterNumber: number | null;
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
        const res = await fetch("/api/pos/counters?scope=all", { cache: "no-store" });
        if (!res.ok) return "unreachable";
        const counters: CounterListEntry[] = await res.json();
        const match = counters.find((c) => c.id === local.counterId);
        // Missing entirely, or counterNumber no longer matches (cleared by an
        // admin release, or reassigned) — this machine's setup is stale.
        if (!match || match.counterNumber !== local.counterNumber) return "released";
        return "valid";
    } catch {
        return "unreachable";
    }
}
