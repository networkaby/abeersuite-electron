import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getNavCountsPayload, hasNavCountsChangedSince } from "@/shared/lib/nav/navCounts";
import { handleApiError } from "@/shared/lib/api";
import { NAV_COUNTS_SINCE_TRUST_MS } from "@/shared/lib/constants/polling";

/**
 * Every sidebar badge in one response — the per-surface { all, new } counts plus
 * chat unread and the notification-bell count — so the sidebar polls once instead
 * of once per badge. Polled from every page.
 *
 * Stateless poll-and-skip: the client sends back the server time it got on its
 * last fetch (`?since=`) and, if nothing relevant changed, gets a tiny
 * `{ unchanged: true }` instead of a full recompute — no server-side cache
 * needed, since the browser tab is the one holding the last-known data.
 * `since` is only honored within `NAV_COUNTS_SINCE_TRUST_MS` — some badge
 * state (SLA overdue, a snoozed ticket waking up) shifts purely because time
 * passed, with no row written, so a since-check that has held for a while
 * must still fall through to the full recompute rather than being trusted
 * indefinitely. That constant is deliberately its OWN, short number — not
 * `NAV_COUNTS_POLL_MS` (now a day-long fallback interval) — because a client
 * cursor is never proof its LAST answer was even right; the shorter this
 * window, the sooner any blind spot in `hasNavCountsChangedSince` self-heals
 * instead of being trusted for however long the tick itself has stretched to.
 */
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const now = new Date();
        const sinceParam = new URL(req.url).searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : null;
        if (since && !Number.isNaN(since.getTime()) && now.getTime() - since.getTime() < NAV_COUNTS_SINCE_TRUST_MS) {
            if (!(await hasNavCountsChangedSince(user.id, since))) {
                return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
            }
        }
        const payload = await getNavCountsPayload(user);
        // `userId` lets the browser file its cache under this user — these counts
        // are per-user, and localStorage is per-origin, so on a shared machine an
        // unscoped entry would hand the next person the previous one's badges.
        return NextResponse.json({ ...payload, computedAt: now.toISOString(), userId: user.id });
    } catch (e) {
        return handleApiError(e, "Failed to load sidebar counts");
    }
}
