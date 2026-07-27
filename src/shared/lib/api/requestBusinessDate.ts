import { BUSINESS_DATE_HEADER } from "@/shared/lib/constants/business";
import { startOfDayUtc, businessToday } from "@/shared/lib/format/formatDate";

/** How far the staff browser's day may sit from the shop's day before we stop
 *  believing it. One day covers the genuine case (a machine a few hours either
 *  side of the shop across midnight); more than that means a wrong clock. */
const MAX_CLIENT_DATE_DRIFT_DAYS = 1;

/**
 * "Today" for a record the user did NOT date themselves.
 *
 *   • staff entry   → the browser's calendar day, sent on `x-business-date`
 *                     (staff PCs auto-sync their clock and sit in the shop, so
 *                     this matches what TallyDate gives when the user types "t")
 *   • customer side → header absent (Razorpay webhook, courier callback, cron)
 *                     → falls back to `businessToday()`, i.e. the shop's
 *                     timezone constant, never the server's UTC clock
 *
 * A malformed header — or one more than a day off the shop's own date — falls
 * back too, so a broken client can only ever get the server's answer, never a
 * garbage date in the books.
 *
 * Returns a DATE-column-safe bound. A date the user TYPES never comes through
 * here — that already arrives as a plain `yyyy-mm-dd` in the request body.
 */
export function requestBusinessDate(req: Request): Date {
    const server = businessToday();
    const raw = req.headers.get(BUSINESS_DATE_HEADER);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return server;

    const claimed = startOfDayUtc(raw);
    if (Number.isNaN(claimed.getTime())) return server;

    // Sanity clamp. Time-sync fixes a PC's CLOCK but not a mis-set TIMEZONE, and
    // a machine stuck on the wrong year would otherwise post vouchers into a
    // closed period. The only legitimate divergence is the midnight edge — one
    // day either side — so anything further is a broken client, not a real date.
    const driftDays = Math.abs(claimed.getTime() - server.getTime()) / 86_400_000;
    return driftDays <= MAX_CLIENT_DATE_DRIFT_DAYS ? claimed : server;
}
