"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { markDeliberateSignOut } from "@/shared/lib/auth/signOutTo";
import { captureMyDay } from "@/shared/lib/hr/myDay";
import { idleLimitMsFor } from "@/shared/lib/hr/dutyTime";
import { IDLE_WARNING_MS } from "@/shared/lib/constants/session";

/**
 * Two jobs, one listener: keep the day's worked minutes honest, and sign out
 * whoever is not standing at the screen.
 *
 *   • PULSE — every few minutes, but ONLY if a real click, key or touch has
 *     happened since the last one. That condition is the whole point. The app
 *     already re-reads data every five minutes on its own (settledReader), and a
 *     machine left switched on would otherwise report a full working day to an
 *     empty shop. A poll is not a person.
 *
 *   • SIGN OUT AFTER — no input for the person's limit ("Sign out after", HR → Job)
 *     ends the session; on a counter the 4-digit PIN signs them back in. Two
 *     minutes' warning first. The server counts nothing for that stretch
 *     (dutyTime.ts drops any gap longer than the limit), so this is about the till
 *     not being left open on somebody's name, not about the maths. (The counter
 *     lock cover was retired 2026-10-16.)
 *
 * Mounted beside SessionWrapper in the protected layouts, so it exists only for
 * signed-in staff and never on the customer portal.
 */

/** How often a pulse may be sent. Well under the idle limit, so a working day is
 *  measured in small pieces and a crash loses minutes rather than hours. */
const PULSE_EVERY_MS = 4 * 60 * 1000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * Every window of the app shares one sign-in, so every window must share one idle
 * clock. Each counts only its own clicks, and without this a tab left untouched for
 * the idle limit signed the person out of the tab they were working in. A window
 * with real input tells the others; they move their clock up to it. Only the window
 * that had the input pulses, so the day is never counted twice.
 */
const ACTIVITY_CHANNEL = "abeer-activity";
/** At most one "still here" per this long — far inside any idle limit. */
const SHARE_INPUT_EVERY_MS = 15_000;

const IDLE_SIGNED_OUT_MESSAGE = "Signed out — the counter was left idle. Sign in again to carry on.";

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

/**
 * The input BEFORE the one happening right now.
 *
 * `getLastInputAt()` cannot answer for a sign-out CLICK, and the reason is in the
 * event order: `pointerdown` is one of the events listened for below, and it fires
 * before React's `onClick`. So by the time the Sign out handler asks, the click
 * itself has already moved `lastInputAt` to now — and the half hour of standing
 * about that the question was asked to exclude is credited in full. The head error
 * survives its own fix.
 *
 * This holds the instant before that, which for a sign-out is the last time he
 * actually worked. For somebody signing out mid-flow it is a second or two earlier
 * and costs nothing; for somebody who downed tools at 14:00 and clicked at 14:30 it
 * is 14:00, which is the whole point.
 */
let priorInputAtModule = 0;

/** The instant of the last real input, for callers outside this component. Pass it
 *  to `captureMyDay({ lastInputAt })` on any path that ends a session WITHOUT a
 *  click of its own — the idle timer, a hardware handover. A path triggered by the
 *  person clicking something must use `getPriorInputAt()` instead. */
export function getLastInputAt(): number {
    return lastInputAtModule;
}

/** The instant of the input before the current one — for a sign-out the person
 *  clicked. See `priorInputAtModule`. */
export function getPriorInputAt(): number {
    return priorInputAtModule;
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
        priorInputAtModule = lastInputAt.current;

        let channel: BroadcastChannel | null = null;
        try { channel = new BroadcastChannel(ACTIVITY_CHANNEL); } catch { /* one window's clock, as before */ }
        let sharedAt = 0;

        const onInput = () => {
            priorInputAtModule = lastInputAt.current;   // before this one overwrites it
            lastInputAt.current = Date.now();
            lastInputAtModule = lastInputAt.current;
            inputSincePulse.current = true;
            // Coming back before the axe falls clears the warning, so the next
            // idle stretch warns again instead of falling silent.
            warned.current = false;
            if (channel && lastInputAt.current - sharedAt >= SHARE_INPUT_EVERY_MS) {
                sharedAt = lastInputAt.current;
                channel.postMessage(sharedAt);
            }
        };
        for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onInput, { passive: true });

        // Input in another window: the person is here, so this window's idle clock
        // moves up too. Not `inputSincePulse` — that window pulses for it.
        if (channel) channel.onmessage = (e: MessageEvent) => {
            const at = typeof e.data === "number" ? e.data : 0;
            if (at <= lastInputAt.current) return;
            lastInputAt.current = at;
            lastInputAtModule = at;
            warned.current = false;
        };

        const tick = setInterval(() => {
            const now = Date.now();
            const idleFor = now - lastInputAt.current;

            // ── Idle: warn, then end it ─────────────────────────────────────────
            if (idleFor >= idleLimitMs) {
                markDeliberateSignOut(IDLE_SIGNED_OUT_MESSAGE);   // explained here, and in the other windows
                toast.error(IDLE_SIGNED_OUT_MESSAGE);
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
            channel?.close();
            clearInterval(tick);
        };
    }, [idleLimitMs]);

    return null;
}
