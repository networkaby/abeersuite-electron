import { isPhoneAppPath } from "@/shared/lib/device/phone";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/**
 * Phone-only sign-in — "Can use Mobile App" without "Can login outside counter".
 *
 * Off a counter, sign-in needs "Can login outside counter" (authorizeStaff.ts). A
 * person who holds only "Can use Mobile App" is let in too, but their session is
 * stamped `phoneOnly` and boxed into the phone app: proxy.ts sends every other page
 * back to the app's Home and refuses every API outside the list below. The owner's
 * use (2026-10-05): staff who may use the phone app but not the office website.
 *
 * Edge-safe — no imports beyond phone.ts and the permission strings — because
 * proxy.ts runs it on every request.
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
    "/api/messages",             // mobile inbox & customer WhatsApp chats
    "/api/inbox",                // mobile staff chat rooms
    "/api/users",                // mobile staff directory
];

/** Office catalogue reads a phone screen holds on the device (one full download,
 *  then only what changed) — open to a phone-only session only with the tick of a
 *  screen that reads it. Office sign-ins pass them on `requireAuth()` alone, but
 *  the product catalogue carries purchase cost for the till, so a phone-only
 *  person without Stock or Photos must not be able to fetch it by address. */
const PHONE_ONLY_CATALOGUE_APIS: { path: string; ticks: readonly string[] }[] = [
    // useProductCatalog — Stock & price, Photos
    { path: "/api/inventory/products/lookup", ticks: [PERMISSIONS.MOBILE_STOCK_VIEW, PERMISSIONS.MOBILE_PHOTOS_EDIT] },
    // masterCatalog.ts — brands, groups, categories on Photos
    { path: "/api/inventory/masters/sync", ticks: [PERMISSIONS.MOBILE_PHOTOS_EDIT] },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** May a phone-only session call this API, whatever it holds? (Asked before the
 *  token is read, so the phone's own calls cost no decrypt.) */
export function isPhoneOnlyApi(pathname: string): boolean {
    return PHONE_ONLY_APIS.some((p) => under(pathname, p));
}

/** May a phone-only session holding `permissions` call this API? */
export function phoneOnlyMayCall(pathname: string, permissions: readonly string[]): boolean {
    if (isPhoneOnlyApi(pathname)) return true;
    const api = PHONE_ONLY_CATALOGUE_APIS.find((a) => under(pathname, a.path));
    return !!api && (permissions.includes(PERMISSIONS.ADMIN_BYPASS) || api.ticks.some((t) => permissions.includes(t)));
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
