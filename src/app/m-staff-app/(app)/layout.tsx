import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import SessionWrapper from "@/shared/components/SessionWrapper";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import MobileShell from "@/modules/mobile/components/MobileShell";
import MobileMessageAlert from "@/modules/mobile/components/MobileMessageAlert";
import StaffPushRegister from "@/modules/mobile/components/StaffPushRegister";
import { PHONE_APP_HOME, PHONE_APP_SIGN_IN, PHONE_APP_THEME } from "@/shared/lib/device/phone";

export const metadata: Metadata = {
    title: "Staff",
    manifest: `${PHONE_APP_HOME}/manifest.webmanifest`,
    // iPhone has no manifest install: "Add to Home Screen" reads these instead.
    appleWebApp: { capable: true, title: `${COMPANY_DETAILS.brandName} Staff` },
    icons: { apple: "/m-icon-192.png" },
};

// Draw under the phone's gesture bar so the tab bar can pad itself by
// env(safe-area-inset-bottom) — without "cover" that inset always reads 0.
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: PHONE_APP_THEME.light },
        { media: "(prefers-color-scheme: dark)", color: PHONE_APP_THEME.dark },
    ],
};

/**
 * The staff phone app — quick views and quick Receive / Pay / Expense for staff
 * away from a counter. It stays in its own area: phones are sent here from any
 * staff page (proxy.ts), and nothing in it links out.
 *
 * Same sign-in as the office site. A phone is never a counter, so it needs "Can
 * login outside counter", or "Can use Mobile App" for a session that opens this app
 * only (authorizeStaff.ts, auth/phoneOnly.ts). Each screen then needs its own
 * `mobile:*` tick, checked by its page and again by its API.
 */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect(PHONE_APP_SIGN_IN);
    if ((session.user as { kind?: string }).kind === "customer") redirect("/portal");
    redirectIfPcWithoutCounter();
    const user = session.user as { name?: string | null; roleLabel?: string; permissions?: string[] };

    return (
        <SessionWrapper session={session}>
            <MobileShell user={{ name: user.name ?? "", roleLabel: user.roleLabel ?? null, permissions: user.permissions ?? [] }}>
                {children}
            </MobileShell>
            <MobileMessageAlert />
            <StaffPushRegister />
            <Toaster position="top-center" />
        </SessionWrapper>
    );
}
