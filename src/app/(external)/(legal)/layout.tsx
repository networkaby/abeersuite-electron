import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";

/**
 * Chrome for the policy pages. Route group only — the URLs stay flat
 * (/privacy, /terms, /refunds, /shipping) because those are the links pasted
 * into the Razorpay activation form and the Google OAuth consent screen.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <ShopHeader />
            <div className="flex-1">{children}</div>
            <ShopFooter />
        </div>
    );
}
