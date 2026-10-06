import type { Metadata, Viewport } from "next";
import ExternalRootShell from "@/modules/external/ExternalRootShell";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_MANIFEST, SHOP_APP_THEME } from "@/shared/lib/device/shopApp";

export const metadata: Metadata = {
    // No brand suffix here: the root layout's title template already appends
    // "· Network Service" to every string title below it. Spelling it out again
    // renders "Customer portal · Network Service · Network Service".
    title: "Customer portal",
    description:
        "Network Service customer portal and online storefront for computer hardware purchases, repair tracking, invoices, warranties, and account sign-in.",
    applicationName: COMPANY_DETAILS.brandName,
    // The customer app (shop + portal) — installable, with bill notifications.
    manifest: SHOP_APP_MANIFEST,
    // iPhone has no manifest install: "Add to Home Screen" reads these instead.
    appleWebApp: { capable: true, title: COMPANY_DETAILS.brandName },
    icons: { apple: "/shop-icon-192.png" },
};

export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: SHOP_APP_THEME.light },
        { media: "(prefers-color-scheme: dark)", color: SHOP_APP_THEME.dark },
    ],
};

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
    return <ExternalRootShell>{children}</ExternalRootShell>;
}
