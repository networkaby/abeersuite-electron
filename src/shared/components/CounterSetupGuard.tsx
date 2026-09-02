"use client";

// "No counter, no entry" — enforced, not merely redirected to.
//
// The counter wizard used to be reachable only through one `router.push` on the login
// screen (staff/login/page.tsx). Nothing behind it: any other route rendered normally
// for a machine holding no counter, and the page's own header claiming "not skippable"
// was not true. That matters because the write guard one layer down
// (prismaClient.ts's createLocal) allows a local write whenever an id RANGE is applied
// — and that range survives losing the counter, so a PC with no counter could still
// mint ids from the block of the counter it used to be.
//
// So this closes the door itself: on Electron, while `counter-setup.json` is absent,
// the only routes that render are the wizard and the login screen.
//
// Deliberately not blocking on the check. The file is read over IPC, and rendering a
// full-screen "checking…" on every navigation would cost every page a flash for a
// condition that is false on every properly set-up machine. Until the answer arrives
// the app renders as usual; a machine with no counter is redirected the moment it does.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup } from "@/shared/lib/counter/setupGate";

/**
 * The two screens that must stay reachable without a counter. Shared with
 * ReplicaReadyGate: nothing that blocks the app may block these, or a PC with no
 * counter can never claim one.
 */
export const COUNTER_FREE_ROUTES = ["/setup/counter", "/staff/login"];
const ALLOWED = COUNTER_FREE_ROUTES;

export default function CounterSetupGuard({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [blocked, setBlocked] = useState(false);

    const allowed = ALLOWED.some((p) => pathname?.startsWith(p));

    useEffect(() => {
        if (!isElectronEnvironment() || allowed) return;

        let cancelled = false;
        void getLocalCounterSetup().then((setup) => {
            if (cancelled) return;
            // Lifting the block matters as much as setting it. Without this the flag
            // latched: the guard blocked a route, sent the machine to the wizard, and
            // when the wizard navigated back after a successful claim the flag was
            // still set — so a correctly set-up counter rendered nothing at all, on
            // every route, until it was restarted.
            if (setup) { setBlocked(false); return; }
            setBlocked(true);
            router.replace(`/setup/counter?next=${encodeURIComponent(pathname || "/office/work-flow-inbox")}`);
        });
        return () => { cancelled = true; };
    }, [pathname, allowed, router]);

    // Once we KNOW there is no counter, stop rendering the app behind the redirect —
    // otherwise the page keeps running (and can keep writing) during the navigation.
    if (blocked && !allowed) return null;
    return <>{children}</>;
}
