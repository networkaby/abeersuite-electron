"use client";

// Keeps the cached counter-setup.json (and, via its side effect in
// reconcileCounterSetup, the window title) honest against the replica while the app is
// running — not just at login. An admin rebinding this device to a different counter
// from /office/admin/counters should show up here without the cashier needing to log
// out and back in.
//
// ── Event-driven, replica only ──────────────────────────────────────────────
// Nothing here talks to the cloud. The check runs once on mount (boot), and again
// whenever the sync worker reports it pulled rows into PosCounter — the worker fires on
// the Realtime signal, and its interval cycle is the safety net for a signal that was
// missed. Every other pull is ignored. This used to poll Supabase every five minutes
// and on every window focus; both are gone, they cost egress for a question the replica
// answers.
//
// ── Acting on the answer ────────────────────────────────────────────────────
// The replica is the DB's answer, one cycle late at most: if it says this machine is
// not that counter, sign the cashier out and reset the PC. Logging in again is what
// routes them back through /setup/counter (see staff/login/page.tsx), so there is one
// setup path, not two. Only a POSITIVE "released" does this — "unreachable" (replica
// not ready yet) still trusts the local file, so a boot before the first pull never
// throws anyone out of the till.
//
// The reset itself (electron/replicaWipe.ts) empties the replica at once: a PC without
// a counter holds no business data, and the outbox is not consulted.
//
// No render output, no cost off a counter PC (reconcileCounterSetup short-circuits to
// "not-set-up" before ever fetching when there's no local cache to check).

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
import { ensureSyncAppliedBridge, SYNC_APPLIED_EVENT, type SyncAppliedInfo } from "@/shared/lib/realtime/syncApplied";

/** The only model whose pull can change this PC's binding. */
const COUNTER_MODEL = "PosCounter";

export default function CounterReconciler() {
    // A release is handled once. Without this a pull landing mid-check could start a
    // second sign-out.
    const releasing = useRef(false);

    useEffect(() => {
        const run = async () => {
            const status = await reconcileCounterSetup();
            if (status !== "released" || releasing.current) return;
            releasing.current = true;

            // Clears the file, stops the worker and empties the replica at once — a PC
            // without a counter holds no business data (electron/replicaWipe.ts).
            await window.electronAPI?.clearCounterSetup?.();
            // Wording matters here: the usual reason is a DEVICE SWAP, not a closure.
            // The counter, its shift and its drawer are untouched — this machine is
            // simply not that counter any more, and must be onboarded again.
            toast.error(
                "This PC no longer holds its counter — an admin released it. " +
                "The shift and drawer are unaffected. This PC's local data has been cleared. " +
                "Sign in again, online, to set this PC up on an available counter.",
                { duration: 15_000 },
            );
            await signOut({ redirect: false });
            // A full load, not router.push: the session cookie is gone and every
            // cached page in memory was rendered for a counter this machine no
            // longer holds.
            window.location.assign("/staff/login");
        };

        void run();

        ensureSyncAppliedBridge();
        const onApplied = (e: Event) => {
            const models = (e as CustomEvent<SyncAppliedInfo>).detail?.models ?? [];
            if (models.includes(COUNTER_MODEL)) void run();
        };
        window.addEventListener(SYNC_APPLIED_EVENT, onApplied);
        return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
    }, []);

    return null;
}
