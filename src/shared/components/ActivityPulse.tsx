"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { markDeliberateSignOut } from "@/shared/lib/auth/signOutTo";
import { captureMyDay } from "@/shared/lib/hr/myDay";
import { IDLE_WARNING_MS, idleLimitMsFor } from "@/shared/lib/hr/dutyTime";

/**
 * Two jobs, one listener: keep the day's worked minutes honest, and sign out a
 * counter nobody is standing at.
 *
 *   • PULSE — every few minutes, but ONLY if a real click, key or touch has
 *     happened since the last one. That condition is the whole point. The app
 *     already re-reads data every five minutes on its own (settledReader), and a
 *     machine left switched on would otherwise report a full working day to an
 *     empty shop. A poll is not a person.
 *
 *   • IDLE SIGN-OUT — no input for IDLE_LIMIT_MS and the session ends, with two
 *     minutes' warning first. The server counts nothing for that stretch either
 *     way (dutyTime.ts drops any gap longer than the limit), so the sign-out is
 *     about the till not being left open on somebody's name, not about the maths.
 *
 * Mounted beside SessionWrapper in the protected layouts, so it exists only for
 * signed-in staff and never on the customer portal.
 */

/** How often a pulse may be sent. Well under the idle limit, so a working day is
 *  measured in small pieces and a crash loses minutes rather than hours. */
const PULSE_EVERY_MS = 4 * 60 * 1000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * The last real keypress or click, at module scope so anything outside this
 * component can read it — the Sign out button in the sidebar most of all.
 *
 * Without it a deliberate sign-out has to fall back to "now", and the server then
 * credits the whole gap since the last pulse as work. Somebody who idles half an
 * hour and THEN clicks Sign out would be paid for the half hour. Mirrored from the
 * ref rather than replacing it: the effect's own timer wants a value that does not
 * make it re-render, and a module variable is not reactive.
 */
let lastInputAtModule = 0;

/** The instant of the last real input, for callers outside this component. Pass it
 *  to `captureMyDay({ lastInputAt })` on any path that ends a session. */
export function getLastInputAt(): number {
    return lastInputAtModule;
}

export default function ActivityPulse() {
    // This person's own limit, carried on the session token so there is no request
    // to make for it. A counter manager's twenty minutes and a technician's three
    // hours are both right — for them. Falls back to the default until the session
    // has resolved, which only matters for the first few seconds after a load.
    const { data: session } = useSession();
    const idleLimitMs = idleLimitMsFor(
        (session?.user as { idleLimitMinutes?: number } | undefined)?.idleLimitMinutes,
    );
    // Seeded in the effect, not here: reading the clock during render is impure
    // (react-hooks/purity) and on a re-render would quietly restart the idle timer.
    const lastInputAt = useRef(0);
    const lastPulseAt = useRef(0);
    const inputSincePulse = useRef(true);   // the sign-in itself counts as input
    const warned = useRef(false);

    useEffect(() => {
        // Mounting means somebody just signed in — the day starts here.
        lastInputAt.current = Date.now();
        lastInputAtModule = lastInputAt.current;

        const onInput = () => {
            lastInputAt.current = Date.now();
            lastInputAtModule = lastInputAt.current;
            inputSincePulse.current = true;
            // Coming back before the axe falls clears the warning, so the next
            // idle stretch warns again instead of falling silent.
            warned.current = false;
        };
        for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onInput, { passive: true });

        const tick = setInterval(() => {
            const now = Date.now();
            const idleFor = now - lastInputAt.current;

            // ── Idle: warn, then end it ──────────────────────────────────────
            if (idleFor >= idleLimitMs) {
                markDeliberateSignOut();   // not a dead session — this one is explained here
                toast.error("Signed out — the counter was left idle. Sign in again to carry on.");
                // The day's figures, read while the session is still good, so the
                // login screen can show him what the day came to when he returns.
                // `lastInputAt` is the whole point on this path: the gap from the last
                // pulse to NOW is longer than his idle limit and credits nothing, but
                // the stretch from that pulse to his last real keypress was work, and
                // only this ref knows when that was.
                void captureMyDay({ lastInputAt: lastInputAt.current })
                    .then(() => signOut({ redirect: false }))
                    .finally(() => window.location.assign("/staff/login"));
                return;
            }
            if (!warned.current && idleFor >= idleLimitMs - IDLE_WARNING_MS) {
                warned.current = true;
                toast("Still there? You will be signed out shortly.", { duration: IDLE_WARNING_MS });
            }

            // ── Pulse: only when a person actually did something ─────────────
            if (!inputSincePulse.current) return;
            if (now - lastPulseAt.current < PULSE_EVERY_MS) return;
            lastPulseAt.current = now;
            inputSincePulse.current = false;
            // Fire and forget. A missed pulse costs a few minutes off the day's
            // total, which is the safe way to be wrong — it never over-pays.
            // `lastInputAt` rides along on the ordinary beat too, not only at
            // sign-out: the server credits up to that instant rather than to the
            // moment the request happened to land.
            void axios.post("/api/hr/activity", { lastInputAt: new Date(lastInputAt.current).toISOString() })
                .catch(() => undefined);
        }, 30_000);

        return () => {
            for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onInput);
            clearInterval(tick);
        };
    }, [idleLimitMs]);

    return null;
}
