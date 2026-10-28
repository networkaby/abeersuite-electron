/**
 * The CUSTOMER app — shop.networkservice.in installed on a phone (PWA, plus the
 * Android wrapper in `shop-app-native/`). Kept apart from the staff app
 * (device/phone.ts): its own manifest `id`, name and package, so a phone can
 * carry both as two separate apps.
 *
 * Like the staff app, every screen is the website: a deploy reaches installed
 * phones at once, and the APK is rebuilt only when the name, icon, colours or
 * address change.
 */

/** Manifest `id` — permanent once phones have installed it. */
export const SHOP_APP_ID = "/shop-app";

/** Where the app opens. */
export const SHOP_APP_START = "/shop";

/** The install file, linked from the shop/portal layout. */
export const SHOP_APP_MANIFEST = "/shop.webmanifest";

/** Page that offers the app (Play Store / APK / Add to Home Screen) — the link
 *  the WhatsApp bill message carries. Open without sign-in. */
export const SHOP_APP_INSTALL = "/app";

/** Android package — must match shop-app-native/capacitor.config.json and
 *  public/.well-known/assetlinks.json. Permanent once phones carry it. */
export const SHOP_APP_ANDROID_PACKAGE = "in.networkservice.shop";

/** The APK, served from `public/` until the Play Store listing is live. */
export const SHOP_APP_APK = "/ns-shop.apk";

/** The Google Play listing — where the Play build's update bar sends people. */
export const SHOP_APP_PLAY_URL = `https://play.google.com/store/apps/details?id=${SHOP_APP_ANDROID_PACKAGE}`;

/** Turn on once the Play listing is public (production): until then the link
 *  shows "item not found" to everyone outside the closed test. */
export const SHOP_APP_ON_PLAY = false;

/**
 * PLAY REVIEW MODE — anything a Google Play reviewer could read as a financial
 * or social feature is kept out of the APP while it is under review. Play
 * rejected the first submission on 2026-10-27: "rewards, points" counts as a
 * financial feature, which only an Organization account may publish, and ours
 * is Personal until the D-U-N-S number arrives.
 *
 * Hidden while true (the website portal keeps every one of them):
 *   - My Wallet (points + gift cards): off the Account list; /m-shop-app/wallet → Account
 *   - "Use my points" at checkout (AppCheckout.tsx)
 *   - My Bills: only the Bills tab; Ledger, Outstanding, "Balance due" and Pay by UPI go
 *   - Social: off the Account list; /m-shop-app/social/* → Account
 *
 * UNDO — once the app is approved (and, for points, the account is an Organization):
 *   1. Set this to false and deploy d_shop. Every spot above comes back; grep
 *      SHOP_APP_PLAY_REVIEW to see them.
 *   2. In Play Console → App content → Financial features, tick "Rewards, points…"
 *      again (only after the Organization conversion) and send for review.
 */
export const SHOP_APP_PLAY_REVIEW = true;

/** Status bar / splash colours — same page colours as the staff app. */
export const SHOP_APP_THEME = { light: "#eff4fb", dark: "#101725" } as const;

/**
 * The customer app's own phone-only screens (Capacitor shell in
 * `shop-app-native/`, opening this address) — the ONE place the address is
 * written; the route folder `src/app/m-shop-app` carries the same name.
 * The website (/, /shop, /portal) stays as it is for browsers.
 */
export const SHOP_NATIVE_HOME = "/m-shop-app";

/** The shell appends this to its user agent (capacitor.config.json
 *  `appendUserAgent`, followed by `/<versionCode>` — build-apk.ps1, read by
 *  AppUpdateBar), so the server and the page both know they are inside it. */
export const SHOP_NATIVE_UA = "NSShopApp";

export function isShopNativePath(pathname: string): boolean {
    return pathname === SHOP_NATIVE_HOME || pathname.startsWith(`${SHOP_NATIVE_HOME}/`);
}

/** Inside the Android customer app. Google sign-in uses a popup, which Google
 *  refuses inside an app's web view — the sign-in page hides it here. */
export function isShopNativeUserAgent(userAgent: string): boolean {
    return userAgent.includes(SHOP_NATIVE_UA);
}

/** Development only: a desktop browser cannot send the app's user agent, so
 *  this cookie (`document.cookie = "nsShopApp=1; path=/"`) stands in for it.
 *  Ignored in production builds. */
export const SHOP_NATIVE_DEV_COOKIE = "nsShopApp";

/** May this request open the app's screens? Only the app itself — every other
 *  visitor is sent to the "Get the app" page. Edge-safe (proxy.ts). */
export function isShopNativeRequest(userAgent: string, devCookie: string | undefined): boolean {
    if (isShopNativeUserAgent(userAgent)) return true;
    return process.env.NODE_ENV !== "production" && devCookie === "1";
}

/** A website address that has its own screen in the app (inside the app only):
 *  an order page, a customer message's short link, a bill or receipt, the Social
 *  pages. Null for the rest. */
export function appScreenFor(pathname: string): string | null {
    // The "Open in app" button: in a browser it offers the download, in the app it opens home.
    if (pathname === SHOP_APP_INSTALL) return SHOP_NATIVE_HOME;
    const order = pathname.match(/^\/shop\/order\/(\d+)$/);
    if (order) return `${SHOP_NATIVE_HOME}/order/${order[1]}`;
    const short = pathname.match(/^\/portal\/b\/([^/]+)$/);
    // Except a UPI request's Pay now (p<payload>.<sig>, upiPayLink.ts — not
    // importable here, it is server-only): the website's pay page opens the UPI
    // app from inside the app too; the app's own screens have no pay page.
    if (short && !/^p[^.]*\.[^.]+$/.test(short[1])) return `${SHOP_NATIVE_HOME}/b/${short[1]}`;
    // A bill or receipt link someone copied from the app or the portal — without
    // this the website page opens inside the app with no header and no way back.
    const bill = pathname.match(/^\/portal\/orders\/(\d+)\/bill$/);
    if (bill) return `${SHOP_NATIVE_HOME}/bill/${bill[1]}`;
    const receipt = pathname.match(/^\/portal\/receipts\/(\d+)$/);
    if (receipt) return `${SHOP_NATIVE_HOME}/receipt/${receipt[1]}`;
    // Social links inside the shared Social views (a friend's profile, back to Social).
    const social = pathname.match(/^\/portal\/social(\/view\/(user|person)\/\d+)?$/);
    if (social) return `${SHOP_NATIVE_HOME}/social${social[1] ?? ""}`;
    return null;
}

/** Firebase's web OAuth client (google-services.json, client_type 3). The app's
 *  native Google sheet (NsGooglePlugin) asks for an ID token for this client, so
 *  Firebase accepts it as if it came from the website's popup. Not a secret. */
export const SHOP_APP_GOOGLE_WEB_CLIENT_ID = "975956928914-74lvv01a726pecea54l79u3jtvoib5a6.apps.googleusercontent.com";
