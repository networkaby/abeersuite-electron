import type { Metadata, Viewport } from "next";
import NativeAppReady from "@/modules/mobile/components/NativeAppReady";
import CustomerAppShell from "@/modules/external/shopApp/CustomerAppShell";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_APK, SHOP_APP_THEME, SHOP_NATIVE_UA } from "@/shared/lib/device/shopApp";
import AppUpdateBar from "@/shared/components/AppUpdateBar";
import { SHOP_APP_RELEASE } from "@/shared/lib/constants/appVersions";

export const metadata: Metadata = {
    title: { absolute: COMPANY_DETAILS.brandName },
    // App screens, not web pages: the website (/, /shop) is what search engines get.
    robots: { index: false, follow: false },
};

// Draw under the status bar and gesture bar, so the top bar and the tab bar can
// pad themselves by env(safe-area-inset-*) — without "cover" those read 0.
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: SHOP_APP_THEME.light },
        { media: "(prefers-color-scheme: dark)", color: SHOP_APP_THEME.dark },
    ],
};

/**
 * The customer app — the screens the Android shell (`shop-app-native/`) opens.
 * Phone-only and separate from the website, which stays as it is for browsers.
 * No session read here, so Home and Categories stay cached pages; the Account
 * tab reads the session itself.
 */
export default function CustomerAppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <NativeAppReady />
            {/* APK on the office address, so the link leaves the app's WebView for Chrome. */}
            <AppUpdateBar uaTag={SHOP_NATIVE_UA} release={SHOP_APP_RELEASE} apkUrl={`${COMPANY_DETAILS.sites.shop}.${SHOP_APP_APK}`} />
            <CustomerAppShell>{children}</CustomerAppShell>
        </>
    );
}
