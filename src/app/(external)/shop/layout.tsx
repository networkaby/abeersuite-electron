import type { Metadata } from "next";
import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export const metadata: Metadata = {
    title: `Shop · ${COMPANY_DETAILS.brandName}`,
    description:
        "Network Service online shop for computers, laptops, printers, CCTV, networking, and PC components, with GST invoices and secure checkout in Indian Rupees.",
};

export default function ShopSectionLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <ShopHeader />
            <div className="flex-1">{children}</div>
            <ShopFooter />
        </div>
    );
}
