"use client";

import { SessionProvider, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useEffect, useRef } from "react";
import axios from "axios";
import { stampRequestContext } from "@/shared/lib/http";
import { attachChangePublisher } from "@/shared/lib/realtime/appChannel";
import { OFFLINE_READ_ONLY, offlineReason } from "@/shared/lib/prisma/offlineError";
import { toast } from "sonner";
import { heardRevokedSignOut, markDeliberateSignOut, wasDeliberateSignOut } from "@/shared/lib/auth/signOutTo";
import { SESSION_IDLE_LABEL, SESSION_REVOKED_MESSAGE } from "@/shared/lib/constants/session";
import ActivityPulse from "@/shared/components/ActivityPulse";

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

/** Long enough to read the line, short enough not to feel stuck. */
const REVOKED_NOTICE_MS = 2_500;
/** Same, for a session that simply went cold. */
const DEAD_NOTICE_MS = 2_500;
/** The most a revoked session's sign-out may hold the screen once its notice is
 *  read. It is one database write, but offline that write waits out its connect
 *  timeout, and the login page is the right place to be either way. */
const DROP_COOKIE_WAIT_MS = 4_000;

/**
 * `dropCookie` is for a session the server has REVOKED. Such a cookie still opens
 * pages wherever the check runs against an older copy of the user row — a counter's
 * replica before its pull lands — so the login page would send the person straight
 * back into the app, where the next save throws them out again. Clearing it here
 * ends that loop whatever the replica says. The sign-out event skips its "end every
 * other login" stamp for a session that is already dead (src/auth.ts), so this cannot
 * sign the person out of a fresh login on another device. (A fresh login made in
 * another window of this same browser during the notice shares this cookie, and goes
 * with it — a 2.5-second window, accepted.)
 */
function goLogin(afterMs = 0, dropCookie = false) {
    if (redirecting || typeof window === "undefined") return;
    if (window.location.pathname.startsWith("/staff/login")) return;
    redirecting = true;
    const back = window.location.pathname + window.location.search;
    const go = () => window.location.assign(`/staff/login?callbackUrl=${encodeURIComponent(back)}`);
    const leave = dropCookie
        ? () => {
            markDeliberateSignOut(true);   // other windows repeat the reason, not the idle one
            void Promise.race([
                signOut({ redirect: false }).catch(() => undefined),
                new Promise((resolve) => setTimeout(resolve, DROP_COOKIE_WAIT_MS)),
            ]).finally(go);
        }
        : go;
    if (afterMs > 0) setTimeout(leave, afterMs); else leave();
}

function SessionGuard() {
    const { status } = useSession();
    const prev = useRef(status);

    useEffect(() => {
        if (prev.current === "authenticated" && status === "unauthenticated") {
            // A session that was live a moment ago and is gone now is a DEAD session,
            // not a visitor who never signed in — and the difference is the whole
            // message. Left silent, a till that went cold overnight throws the cashier
            // at the login screen with no word of why, which reads as the app having
            // crashed. The one case that needs no explanation is the person who chose
            // it: they know, and telling them their session expired would be nonsense.
            if (!wasDeliberateSignOut() && !redirecting) {
                toast.error(`Signed out after ${SESSION_IDLE_LABEL} with nothing happening — please sign in again.`, { duration: DEAD_NOTICE_MS });
                goLogin(DEAD_NOTICE_MS);
            } else if (heardRevokedSignOut() && !redirecting) {
                // Another window was refused and signed out; this one says why too.
                toast.error(SESSION_REVOKED_MESSAGE, { duration: REVOKED_NOTICE_MS });
                goLogin(REVOKED_NOTICE_MS);
            } else {
                goLogin();
            }
        }
        prev.current = status;
    }, [status]);

    useEffect(() => {
        const id = axios.interceptors.response.use(
            (r) => r,
            (err) => {
                if (err?.response?.status === 401) {
                    // A token pulled out from under a working session (a sign-out on
                    // this same login elsewhere, or an admin changing this person's
                    // role or position) says so — otherwise the screen just jumps to
                    // the login page mid-work and reads as a random logout. Sign-out
                    // still happens either way; the pause only buys time to read it.
                    const revoked = (err?.response?.data as { code?: string } | undefined)?.code === "SESSION_REVOKED";
                    if (revoked && !redirecting) {
                        toast.error(SESSION_REVOKED_MESSAGE, { duration: REVOKED_NOTICE_MS });
                    }
                    goLogin(revoked ? REVOKED_NOTICE_MS : 0, revoked);
                }
                // Bare `axios` does not inherit the `http` instance's interceptors,
                // so without this a save refused for being offline would surface as a
                // bare "request failed" on every screen that still uses global axios.
                if ((err?.response?.data as { error?: string } | undefined)?.error === OFFLINE_READ_ONLY) {
                    toast.error(offlineReason(err?.response?.data));
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
            {/* Mounted here rather than in each protected layout: one place, and
                it can never be forgotten on a new area. Staff-only for the same
                reason the guard is — the portal never mounts this wrapper. */}
            <ActivityPulse />
            {children}
        </SessionProvider>
    );
}
