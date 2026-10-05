import { isPhoneAppPath } from "@/shared/lib/device/phone";

/**
 * Phone-only sign-in — "Can use Mobile App" without "Can login outside counter".
 *
 * Off a counter, sign-in needs "Can login outside counter" (authorizeStaff.ts). A
 * person who holds only "Can use Mobile App" is let in too, but their session is
 * stamped `phoneOnly` and boxed into the phone app: proxy.ts sends every other page
 * back to the app's Home and refuses every API outside the list below. The owner's
 * use (2026-10-05): staff who may use the phone app but not the office website.
 *
 * Edge-safe — no imports beyond phone.ts — because proxy.ts runs it on every request.
 */

/** The APIs a phone-only session may call — the phone app's own, and what its
 *  shared shell needs. Quick Receive / Pay / Expense save through the ordinary
 *  voucher API, which still checks its own create + post ticks. */
const PHONE_ONLY_APIS = [
    "/api/auth",                 // session, sign-out
    "/api/mobile",               // every phone screen
    "/api/accountancy/vouchers", // Quick Receive / Pay / Expense
    "/api/hr/activity",          // the attendance heartbeat (ActivityPulse)
    "/api/counter/status",       // the status stores woken at sign-in
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** May a phone-only session call this API? */
export function isPhoneOnlyApi(pathname: string): boolean {
    return PHONE_ONLY_APIS.some((p) => under(pathname, p));
}

/** May a phone-only session open this page? The app itself; public pages are
 *  decided by proxy.ts before this is asked. */
export function isPhoneOnlyPage(pathname: string): boolean {
    return isPhoneAppPath(pathname);
}

/** Is this session (or token) phone-only? */
export function isPhoneOnlySession(user: unknown): boolean {
    return !!user && (user as { phoneOnly?: unknown }).phoneOnly === true;
}
