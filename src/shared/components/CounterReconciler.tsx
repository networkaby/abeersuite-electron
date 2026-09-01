"use client";

// Keeps the cached counter-setup.json (and, via its side effect in
// reconcileCounterSetup, the window title) honest against the server while
// the app is running — not just at login. An admin rebinding this device to
// a different counter from /office/admin/counters should show up here
// without the cashier needing to log out and back in.
//
// ── Acting on the answer, not just asking ───────────────────────────────────
// This used to throw the result away, which made the whole component decorative
// for the one case that matters. A machine whose counter the DB no longer says
// it holds kept its stale counter-setup.json, kept the counter number in the
// window title, and kept billing counter-prefixed vouchers under a counter it
// did not own — for as long as the session lasted, because only the login screen
// ever handled "released" and a logged-in cashier never sees it.
//
// The DB is the authority: if it says this machine is not that counter, sign the
// cashier out. Logging in again is what routes them back through /setup/counter
// (see staff/login/page.tsx), so there is one setup path, not two. Only a
// POSITIVE "released" does this — "unreachable" still trusts the local file, so
// a network blip never throws anyone out of the till.
//
// No render output, no network cost off a counter PC (reconcileCounterSetup
// short-circuits to "not-set-up" before ever fetching when there's no local
// cache to check). Interval is deliberately slow — this is an admin action
// that happens rarely, not something worth polling for.

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { reconcileCounterSetup } from "@/shared/lib/counter/setupGate";

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export default function CounterReconciler() {
    // A release is handled once. Without this the interval, the visibility
    // handler and the in-flight check could each start their own sign-out.
    const releasing = useRef(false);

    useEffect(() => {
        const run = async () => {
            const status = await reconcileCounterSetup();
            if (status !== "released" || releasing.current) return;
            releasing.current = true;

            await window.electronAPI?.clearCounterSetup?.();
            toast.error("This PC is no longer set as a counter. Sign in again and pick an available counter.");
            await signOut({ redirect: false });
            // A full load, not router.push: the session cookie is gone and every
            // cached page in memory was rendered for a counter this machine no
            // longer holds.
            window.location.assign("/staff/login");
        };

        void run();
        const timer = setInterval(() => void run(), RECONCILE_INTERVAL_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") void run();
        };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    return null;
}
