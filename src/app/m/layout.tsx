import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import SessionWrapper from "@/shared/components/SessionWrapper";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import MobileNav from "@/modules/mobile/MobileNav";

export const metadata: Metadata = {
    title: "Mobile",
    manifest: "/m/manifest.webmanifest",
    appleWebApp: { capable: true, title: COMPANY_DETAILS.brandName },
};

// Draw under the phone's gesture bar so the tab bar can pad itself by
// env(safe-area-inset-bottom) — without "cover" that inset always reads 0.
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
};

/**
 * The phone app — a few read-only screens for staff away from a counter.
 *
 * Same sign-in as the office site, and so the same rule: a phone is never a
 * counter, so only someone with "Can login outside counter" gets in (enforced at
 * sign-in, authorizeStaff.ts). Each screen then needs its own `mobile:*` tick,
 * checked by its page and again by its API.
 */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect("/staff/login?callbackUrl=/m");
    if ((session.user as { kind?: string }).kind === "customer") redirect("/portal");
    redirectIfPcWithoutCounter();
    const permissions = (session.user as { permissions?: string[] }).permissions ?? [];

    return (
        <SessionWrapper session={session}>
            {/* Bottom padding = the tab bar (h-16) plus the phone's gesture area. */}
            <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
                {children}
            </div>
            <MobileNav permissions={permissions} />
            <Toaster position="top-center" />
        </SessionWrapper>
    );
}
