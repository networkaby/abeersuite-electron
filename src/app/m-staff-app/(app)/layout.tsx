import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import SessionWrapper from "@/shared/components/SessionWrapper";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import MobileShell from "@/modules/mobile/MobileShell";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

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
};

/**
 * The staff phone app — quick views and quick Receive / Pay / Expense for staff
 * away from a counter. It stays in its own area: phones are sent here from any
 * staff page (proxy.ts), and nothing in it links out.
 *
 * Same sign-in as the office site, and so the same rule: a phone is never a
 * counter, so only someone with "Can login outside counter" gets in (enforced at
 * sign-in, authorizeStaff.ts). Each screen then needs its own `mobile:*` tick,
 * checked by its page and again by its API.
 */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect(`/staff/login?callbackUrl=${PHONE_APP_HOME}`);
    if ((session.user as { kind?: string }).kind === "customer") redirect("/portal");
    redirectIfPcWithoutCounter();
    const user = session.user as { name?: string | null; roleLabel?: string; permissions?: string[] };

    return (
        <SessionWrapper session={session}>
            <MobileShell user={{ name: user.name ?? "", roleLabel: user.roleLabel ?? null, permissions: user.permissions ?? [] }}>
                {children}
            </MobileShell>
            <Toaster position="top-center" />
        </SessionWrapper>
    );
}
