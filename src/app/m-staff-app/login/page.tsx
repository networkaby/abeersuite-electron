import type { Metadata, Viewport } from "next";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import StaffLoginPage from "@/app/staff/login/page";

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
 * `(app)` group.
 */
export default StaffLoginPage;
