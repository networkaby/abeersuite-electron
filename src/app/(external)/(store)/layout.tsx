import type { Metadata } from "next";
import StorefrontChrome from "@/modules/external/shop/StorefrontChrome";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export const metadata: Metadata = {
    // Must OPEN with exactly "Network Service" - Google's OAuth brand
    // verification compares the consent-screen app name against the home page
    // name, and the title tag is what its reviewer/crawler reads first.
    //
    // `absolute` opts out of the root layout's "%s · Network Service" template.
    // Without it the brand is appended a second time, and the home page ends up
    // titled "Network Service · ... · Network Service".
    title: {
        absolute: `${COMPANY_DETAILS.brandName} · Computer Hardware Shop & Customer Portal`,
    },
    description:
        "Network Service is an online storefront and customer portal where customers buy computer hardware, track repairs, and view orders, GST invoices, and warranties.",
    applicationName: COMPANY_DETAILS.brandName,
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
    return <StorefrontChrome>{children}</StorefrontChrome>;
}
