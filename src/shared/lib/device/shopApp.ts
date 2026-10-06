/**
 * The CUSTOMER app — shop.networkservice.in installed on a phone (PWA, plus the
 * Android wrapper in `android-shop/`). Kept apart from the staff app
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

/** Android package — must match android-shop/twa-manifest.json and
 *  public/.well-known/assetlinks.json. Permanent once phones carry it. */
export const SHOP_APP_ANDROID_PACKAGE = "in.networkservice.shop";

/** The APK, served from `public/` until the Play Store listing is live. */
export const SHOP_APP_APK = "/ns-shop.apk";

/** Status bar / splash colours — same page colours as the staff app. */
export const SHOP_APP_THEME = { light: "#eff4fb", dark: "#101725" } as const;
