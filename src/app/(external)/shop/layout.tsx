import type { Metadata } from "next";
import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";

export const metadata: Metadata = {
    // Bare word on purpose — the root title template appends the brand.
    title: "Shop",
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
