"use client";

// Keeps the cached counter-setup.json (and, via its side effect in
// reconcileCounterSetup, the window title) honest against the replica while the app is
// running — not just at login. An admin rebinding this device to a different counter
// from /office/admin/counters should show up here without the cashier needing to log
// out and back in.
//
// ── Three triggers, none of them a timer ────────────────────────────────────
//   1. Mount (boot) — replica.
//   2. The `settings` change signal — the moment an admin's release is announced, ASKED
//      OF THE CLOUD (see below). This is the one that makes a release land in seconds.
//   3. The sync worker reporting it pulled rows into PosCounter — replica. The safety
//      net for a signal that never arrived (the socket was down, the release was made
//      by a script), and the only trigger that works offline.
//
// This used to poll Supabase every five minutes and on every window focus; both are
// gone, they cost egress for a question an event answers.
//
// ── Why trigger 2 exists, and why it reads the cloud ────────────────────────
// Trigger 3 alone put the most urgent question in the app at the end of the slowest
// path: wait for the worker to wake, scan every table, commit, and only then report.
// A worker that is stopped, wedged, or whose socket is down means a released counter
// keeps billing until somebody else's activity happens to wake it — which is exactly
// what was seen in the field. Nothing in the app itself was subscribed to the signal
// that says "a counter setting changed", so the announcement arrived and was dropped.
//
// It reads the cloud (`authoritative`) rather than the replica because the signal
// ARRIVES BEFORE THE WORKER HAS PULLED: the replica still says "bound" at that instant,
// so a replica read here would answer "valid" and the release would wait for trigger 3
// after all. That is one row read, only when a `settings` signal actually arrived —
// not a poll. Offline, `reconcileCounterSetup` skips the authoritative hop by itself
// and the replica answers, so this costs nothing on a counter that is cut off.
//
// `settings` is a coarse bucket — it also covers users, roles, positions, branches and
// org settings — so an admin saving any of those costs each counter one row read too.
// That is the price of a vocabulary that cannot rot (see topics.ts): those writes are
// rare admin actions, and one row is cheaper than the narrower map that would need
// maintaining. If it ever stops being rare, split the topic, not this listener.
//
// ── Acting on the answer ────────────────────────────────────────────────────
// The answer is the DB's own on trigger 2, and the replica's — one cycle late at most —
// on 1 and 3. Either way: if it says this machine is not that counter, sign the cashier
// out and reset the PC. Logging in again is what
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
import { onChangeSignal } from "@/shared/lib/realtime/appChannel";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";

/** The only model whose pull can change this PC's binding. */
const COUNTER_MODEL = "PosCounter";

/** The topic every /api/pos/counters write announces (see realtime/topics.ts). */
const COUNTER_TOPIC = "settings";

/** One check per burst of signals — an admin release fires the request and the list's
 *  re-read behind it. Same window `useRealtimeTopics` uses, for the same reason. */
const SETTLE_MS = 600;

export default function CounterReconciler() {
    // A release is handled once. Without this a pull landing mid-check could start a
    // second sign-out.
    const releasing = useRef(false);

    useEffect(() => {
        const run = async (authoritative = false) => {
            const status = await reconcileCounterSetup(authoritative);
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

        // Trigger 2 — see the header. Only on Electron: off it there is no local setup
        // file to reconcile, so subscribing would open the leader socket for a check
        // that short-circuits to "not-set-up" every time.
        let settle: ReturnType<typeof setTimeout> | null = null;
        const offSignal = !isElectronEnvironment() ? null : onChangeSignal((sig) => {
            if (!sig.topics.includes(COUNTER_TOPIC) || settle || releasing.current) return;
            settle = setTimeout(() => { settle = null; void run(true); }, SETTLE_MS);
        });

        return () => {
            window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
            offSignal?.();
            if (settle) clearTimeout(settle);
        };
    }, []);

    return null;
}
