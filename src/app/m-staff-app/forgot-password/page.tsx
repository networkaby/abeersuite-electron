import type { Metadata, Viewport } from "next";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import StaffForgotPasswordPage from "@/app/staff/forgot-password/page";

export const metadata: Metadata = {
    title: "Forgot password",
    manifest: `${PHONE_APP_HOME}/manifest.webmanifest`,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * The phone app's password reset — the staff form, served inside the app's PWA scope
 * so Chrome shows no address bar (see m-staff-app/login). Public in proxy.ts.
 */
export default StaffForgotPasswordPage;
