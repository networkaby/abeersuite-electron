/**
 * "Is this request from a phone?" — for sending phones to the staff phone app.
 *
 * Chromium's own Client Hint answers first: `Sec-CH-UA-Mobile` is `?1` on a phone
 * and `?0` on a tablet, a computer, or a phone with Chrome's "Desktop site"
 * switched on — which is exactly the escape hatch an admin uses to reach the full
 * office on a phone. Browsers without the hint (Safari, Firefox) fall back to the
 * user agent: iPhone / iPod, Android with "Mobile", or the generic "Mobi" token.
 * iPads and Android tablets read as computers on purpose — a tablet can run the
 * office or a counter.
 *
 * A convenience, never a security check: what anyone may open is still decided by
 * the Role ticks. Edge-safe — no imports — because proxy.ts runs it on every page.
 */
export function isPhoneRequest(headers: Headers): boolean {
    const hint = headers.get("sec-ch-ua-mobile");
    if (hint === "?1") return true;
    if (hint === "?0") return false;
    const ua = headers.get("user-agent") ?? "";
    return /iPhone|iPod|Android.+Mobile|Mobi/i.test(ua) && !/iPad|Tablet/i.test(ua);
}

/**
 * The staff phone app's home, and the area it lives in — the ONE place its address
 * is written (owner, 2026-10-03: moved off `/m`, which is kept free for later). The
 * route folder `src/app/m-staff-app` must carry the same name.
 *
 * A future app at `/m` must declare its PWA scope as `/m/` (with the slash): scope
 * matching is a plain prefix test, so a bare `/m` would also claim this app's pages.
 */
export const PHONE_APP_HOME = "/m-staff-app";

/** The app's page colour (globals.css --surface-page, light and dark) as hex, for
 *  the phone's status bar and the install splash — so the top of the screen is one
 *  colour with the app's top bar instead of a white strip. Change with the theme. */
export const PHONE_APP_THEME = { light: "#eff4fb", dark: "#101725" } as const;

/** Where the Downloads QR points: the app's install page — open without sign-in,
 *  since installing needs none (the app asks for the sign-in when first opened). */
export const PHONE_APP_INSTALL = `${PHONE_APP_HOME}/install`;

/**
 * The Android wrapper (a Trusted Web Activity, `android/`): a thin APK that opens the
 * app full screen through Chrome — every screen is still this website, so a deploy
 * reaches the phones without a new APK. Sideloaded from the install page for now.
 * The package id is permanent once phones carry it (Android treats a new id as a
 * different app); it must match `phone-app/capacitor.config.json` and
 * `public/.well-known/assetlinks.json`.
 */
export const PHONE_APP_ANDROID_PACKAGE = "in.networkservice.staff";

/** Retired 2026-11-27 (owner: Google Play only) — the file is gone from `public/`;
 *  kept as the path old sideloaded builds still ask their updater for. */
export const PHONE_APP_APK = "/ns-staff.apk";

/** The staff app's Play listing. Opens only for a Google account on the
 *  internal-test list ("NS staff" in Play Console) that has joined the test. */
export const PHONE_APP_PLAY_URL = `https://play.google.com/store/apps/details?id=${PHONE_APP_ANDROID_PACKAGE}`;

/** The internal test's join page — step 1 on a new phone, before the Play listing
 *  opens for that account. Play Console → NS Staff → Internal testing → Testers → Copy link. */
export const PHONE_APP_TEST_URL = "https://play.google.com/apps/internaltest/4701303166272995640";

/** The Capacitor shell (phone-app/) appends this to its user agent, followed by
 *  `/<versionCode>` (build-apk.ps1) — read by AppUpdateBar. */
export const PHONE_APP_UA = "NSStaffApp";

/** The app's own sign-in page — the staff sign-in form, served inside the app's PWA
 *  scope. `/staff/login` is outside it, and an installed app leaving its scope makes
 *  Chrome show an address bar with an ✕ over the screen. */
export const PHONE_APP_LOGIN = `${PHONE_APP_HOME}/login`;

/** The app's own forgot-password page — same reason as `PHONE_APP_LOGIN`. */
export const PHONE_APP_FORGOT = `${PHONE_APP_HOME}/forgot-password`;

/** Send a signed-out phone-app visitor to the app's sign-in, coming back to Home. */
export const PHONE_APP_SIGN_IN = `${PHONE_APP_LOGIN}?callbackUrl=${PHONE_APP_HOME}`;

export function isPhoneAppPath(pathname: string): boolean {
    return pathname === PHONE_APP_HOME || pathname.startsWith(`${PHONE_APP_HOME}/`);
}

/**
 * A `?from=` back address, accepted only when it is one of the app's own screens —
 * one or two plain segments under the app (`…/receivables`, `…/quick/pay`), no
 * query, no other site. Anything else gives null and the caller's default.
 */
export function appBack(from: string | null | undefined): string | null {
    if (!from || !from.startsWith(`${PHONE_APP_HOME}/`)) return null;
    return /^\/[a-z-]+(\/[a-z-]+)?$/.test(from.slice(PHONE_APP_HOME.length)) ? from : null;
}
