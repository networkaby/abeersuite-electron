/**
 * The shop's operating timezone — a plain editable constant.
 *
 * **Change this one line to move the business to another zone.** Any IANA zone
 * name works ("Asia/Kolkata", "Asia/Dubai", "America/New_York", …).
 *
 * It is NOT read from an env-var: Vercel reserves the `TZ` name, so it cannot be
 * set per-project. `Intl` needs no such setting — it computes calendar parts for
 * any named zone directly, on any server, whatever the server's own clock says.
 *
 * Used ONLY to answer "what is today?" for records the user did not date
 * themselves — see `businessTodayIso()` / `businessToday()` in
 * `src/shared/lib/format/formatDate.ts` — and to read the shop's office hours
 * as civil times (`hr/seasonalHours.ts`). A date the user types is already a
 * plain calendar date and never passes through here.
 */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/**
 * Header carrying the STAFF browser's calendar day (yyyy-mm-dd) on every request
 * from the app.
 *
 * Staff machines auto-sync their clock from the internet and sit in the shop, so
 * their date is the truth for a staff entry — and it is the same date TallyDate
 * already resolves when the user types "t". Sending it means a voucher the
 * server dates itself agrees with one the user dates by hand, even at 01:00.
 *
 * Customer-side writes have no staff browser (Razorpay webhook, courier
 * callback, cron), so the header is simply absent there and the server falls
 * back to `BUSINESS_TIME_ZONE` — see `requestBusinessDate()`.
 */
export const BUSINESS_DATE_HEADER = "x-business-date";
