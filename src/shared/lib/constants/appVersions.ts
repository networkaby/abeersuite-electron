/**
 * The latest Android app builds (no Play Store — staff and customers install the
 * APK from the website themselves). An installed app older than `code` shows the
 * "New version available" bar (AppUpdateBar); `urgent` turns it into a full-screen
 * notice that cannot be put off.
 *
 * Each build script (phone-app/ and shop-app-native/ build-apk.ps1) writes its
 * app's `code` / `name` here from android/app/build.gradle and copies the APK into
 * public/ — both reach phones in the same deploy, so the bar never points at a
 * file that is not there yet. `urgent` is yours to set by hand.
 */
export type AppRelease = { code: number; name: string; urgent: boolean };

export const STAFF_APP_RELEASE: AppRelease = { code: 4, name: "2.1.1", urgent: false };

export const SHOP_APP_RELEASE: AppRelease = { code: 5, name: "2.1.1", urgent: false };
