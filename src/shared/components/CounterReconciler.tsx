"use client";

// Keeps the cached counter-setup.json (and, via its side effect in
// reconcileCounterSetup, the window title) honest against the server while
// the app is running — not just at login. An admin rebinding this device to
// a different counter from /office/admin/counters should show up here
// without the cashier needing to log out and back in.
//
// No render output, no network cost off a counter PC (reconcileCounterSetup
// short-circuits to "not-set-up" before ever fetching when there's no local
// cache to check). Interval is deliberately slow — this is an admin action
// that happens rarely, not something worth polling for.

import { useEffect } from "react";
import { reconcileCounterSetup } from "@/shared/lib/counter/setupGate";

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export default function CounterReconciler() {
    useEffect(() => {
        const run = () => void reconcileCounterSetup();

        run();
        const timer = setInterval(run, RECONCILE_INTERVAL_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") run();
        };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    return null;
}
