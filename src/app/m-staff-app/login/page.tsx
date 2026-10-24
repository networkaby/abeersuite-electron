import type { Metadata, Viewport } from "next";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import StaffLoginPage from "@/app/staff/login/page";
import { AppVersionLine } from "@/shared/components/AppUpdateBar";
import { STAFF_APP_RELEASE } from "@/shared/lib/constants/appVersions";
import { PHONE_APP_HOME, PHONE_APP_INSTALL, PHONE_APP_UA } from "@/shared/lib/device/phone";

export const metadata: Metadata = {
    title: "Sign in",
    manifest: `${PHONE_APP_HOME}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: `${COMPANY_DETAILS.brandName} Staff` },
    icons: { apple: "/m-icon-192.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * The phone app's sign-in — the same staff sign-in form, served inside the app's PWA
 * scope. Signing in at /staff/login left the scope, and Chrome then showed an address
 * bar with an ✕ over the installed app. Public in proxy.ts; outside the signed-in
 * `(app)` group. The version line under it says whether this phone's app is current.
 */
export default function PhoneAppLoginPage() {
    return (
        <>
            <StaffLoginPage />
            <AppVersionLine uaTag={PHONE_APP_UA} release={STAFF_APP_RELEASE} installUrl={`${COMPANY_DETAILS.sites.office}.${PHONE_APP_INSTALL}`} />
        </>
    );
}
