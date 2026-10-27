import ShopHeader from "@/modules/external/shop/ShopHeader";
import ShopFooter from "@/modules/external/shop/ShopFooter";
import StorefrontTracking from "@/modules/external/shop/StorefrontTracking";

/**
 * The storefront's outer shell — sticky header, page body, footer.
 *
 * Every customer-facing storefront section wears this: the store home
 * (`(store)/layout.tsx`), the catalog and its sub-pages (`shop/layout.tsx`),
 * and the root-level slug pages (`[slug]/layout.tsx`). It lives here rather
 * than in `(external)/layout.tsx` because the portal and login pages sit under
 * that same group and bring their own chrome.
 *
 * Tracking codes (Settings → Tracking Codes) load here, so they reach shop
 * pages only.
 *
 * Each of those layouts keeps its OWN `metadata` export — the shell is the
 * markup they share, not their titles.
 */
export default function StorefrontChrome({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <ShopHeader />
            <div className="flex-1">{children}</div>
            <ShopFooter />
            <StorefrontTracking />
        </div>
    );
}
