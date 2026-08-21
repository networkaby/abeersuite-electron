"use client";

import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useEffect, useRef } from "react";
import axios from "axios";
import { stampRequestContext } from "@/shared/lib/http";
import { attachChangePublisher } from "@/shared/lib/realtime/appChannel";
import { OFFLINE_READ_ONLY } from "@/shared/lib/prisma/offlineError";
import { toast } from "sonner";

// Staff-only wrapper (mounted by every (protected) layout, never the portal).
// Adds two layers that make "logout" actually stick across tabs:
//   1. Instant cross-tab — when an established session disappears (sign-out in
//      another tab, which next-auth broadcasts), redirect this tab to login.
//   2. Server-side revocation catch — any API 401 (e.g. a token revoked via
//      tokensValidFrom after logout) kicks the tab to login on its next request,
//      so a logged-out till can't keep transacting.
//
// It also stamps the staff machine's calendar day on every request. Being
// staff-only is the point: the portal never mounts this, so a CUSTOMER-side
// write carries no date header and the server falls back to the shop's timezone
// constant. Most POS/office components still call bare `axios`, which does not
// inherit the `http` instance's interceptors — hence the global registration.

let redirecting = false;
function goLogin() {
    if (redirecting || typeof window === "undefined") return;
    if (window.location.pathname.startsWith("/staff/login")) return;
    redirecting = true;
    const back = window.location.pathname + window.location.search;
    window.location.assign(`/staff/login?callbackUrl=${encodeURIComponent(back)}`);
}

function SessionGuard() {
    const { status } = useSession();
    const prev = useRef(status);

    useEffect(() => {
        if (prev.current === "authenticated" && status === "unauthenticated") goLogin();
        prev.current = status;
    }, [status]);

    useEffect(() => {
        const id = axios.interceptors.response.use(
            (r) => r,
            (err) => {
                if (err?.response?.status === 401) goLogin();
                // Bare `axios` does not inherit the `http` instance's interceptors,
                // so without this a save refused for being offline would surface as a
                // bare "request failed" on every screen that still uses global axios.
                if ((err?.response?.data as { error?: string } | undefined)?.error === OFFLINE_READ_ONLY) {
                    toast.error("Offline — read only. Reconnect to save.");
                }
                return Promise.reject(err);
            },
        );
        const reqId = axios.interceptors.request.use(stampRequestContext);
        // Same reason as the stamp above: bare `axios` does not inherit the
        // `http` instance's interceptors, so writes made through it would
        // otherwise never tell anyone else's screen that something moved.
        const pubId = attachChangePublisher(axios);
        return () => {
            axios.interceptors.response.eject(id);
            axios.interceptors.request.eject(reqId);
            axios.interceptors.response.eject(pubId);
        };
    }, []);

    return null;
}

// `session` should be passed by every (protected) layout — they all already
// `await auth()` for their redirect guard, so it costs nothing. Without it
// next-auth discards the server-resolved session and each page load must
// re-fetch /api/auth/session over the network; until that lands `useSession()`
// reports status "loading" with no user, so every permission-gated control
// (Save buttons, lifecycle actions) renders hidden and only appears once the
// fetch returns — the "UI missing on load, fine after refresh" symptom.
// Priming it here means useSession() is authenticated on the very first render.
export default function SessionWrapper({
    children,
    session,
}: {
    children: React.ReactNode;
    session?: Session | null;
}) {
    return (
        <SessionProvider session={session}>
            <SessionGuard />
            {children}
        </SessionProvider>
    );
}
