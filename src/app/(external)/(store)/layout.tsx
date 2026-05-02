import type { Metadata } from "next";
import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";

export const metadata: Metadata = {
    title: "Network Shop · Computers, Printers, CCTV & Components in ₹",
    description:
        "Shop laptops, desktops, printers, CCTV kits, monitors and PC components in ₹. Curated for India with secure checkout.",
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
