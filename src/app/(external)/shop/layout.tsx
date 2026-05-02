import ShopHeader from "@/modules/external/shop/ShopHeader";

export default function ShopSectionLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <ShopHeader />
            <div className="flex-1">{children}</div>
        </div>
    );
}
