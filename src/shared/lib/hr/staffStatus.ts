/**
 * Has this staff member left?
 *
 * One rule, read by every sign-in path and by the HR screens, so the counter and
 * the office can never disagree about whether a person may still work here.
 *
 * `leftOn` is a DATE column — "no sign-in from this date (inclusive)". The
 * comparison is date-only against the SHOP's calendar day, never the server's
 * clock: Vercel runs in UTC, and a person marked as left today would otherwise
 * still get in between midnight and 05:30 IST.
 */

import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";

export function staffHasLeft(
    profile: { leftOn: Date | string | null } | null | undefined,
    todayIso: string = businessTodayIso(),
): boolean {
    const leftOn = profile?.leftOn;
    if (!leftOn) return false;
    const iso = typeof leftOn === "string" ? leftOn.slice(0, 10) : toDateOnlyUtc(leftOn);
    return iso <= todayIso;
}
