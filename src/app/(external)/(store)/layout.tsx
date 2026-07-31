import type { Metadata } from "next";
import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export const metadata: Metadata = {
    // Must read exactly "Network Service" - Google's OAuth brand verification
    // compares the consent-screen app name against the home page name, and the
    // title tag is what its reviewer/crawler reads first.
    title: `${COMPANY_DETAILS.brandName} · Computer Hardware Shop & Customer Portal`,
    description:
        "Network Service is an online storefront and customer portal where customers buy computer hardware, track repairs, and view orders, GST invoices, and warranties.",
    applicationName: COMPANY_DETAILS.brandName,
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <ShopHeader />
            <div className="flex-1">{children}</div>
            <ShopFooter />
        </div>
    );
}
