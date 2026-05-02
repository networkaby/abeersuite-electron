import type { Metadata } from "next";
import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";

export const metadata: Metadata = {
    title: "Shop · IT Hardware & Components",
    description:
        "Computers, laptops, printers, CCTV, networking, and PC components. Browse in ₹ with secure checkout.",
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
