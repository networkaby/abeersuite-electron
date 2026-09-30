import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { requireStaffPage } from "@/shared/lib/auth/permissions";
import ProductDetailView from "@/modules/external/shop/ProductDetailView";
import { loadShopProduct } from "@/shared/lib/shop/loadShopProduct";
import { productShopUrl } from "@/shared/lib/shop/productPublic";

export const metadata: Metadata = { title: "Product preview", robots: { index: false, follow: false } };

/**
 * Full-page preview of a shop product, draft or live — opened in a new tab from
 * the product form, its card and the Products list.
 *
 * A bare staff page, outside /office, so it shows the product the way the shop
 * does — no sidebar or finance bar around it. Not under /shop because the desktop
 * app is built without the shop pages and many staff may only sign in on a
 * counter: this runs on the app's own sign-in. `proxy.ts` sends a signed-out
 * visitor to the staff sign-in and locks it on the Products tick (`LOCKED_AS` in
 * pageAccess.ts); `requireStaffPage` is the same defence in depth as the receipts.
 *
 * Same loader and same ProductDetailView as the shop's product page, so it shows
 * exactly the price and stock state a customer will get. A live product also
 * offers the real shop page, which opens in the computer's own browser.
 */
export default async function ProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
    await requireStaffPage();
    const { id } = await params;
    if (!/^\d+$/.test(id)) notFound();
    const found = await loadShopProduct(id, true);
    if (!found) notFound();
    const { product, liveInShop } = found;

    return (
        <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:py-12">
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="flex-1">
                    {liveInShop
                        ? "Staff preview — this product is live in the shop."
                        : "Staff preview — this product is not published to customers yet."}
                </span>
                {liveInShop ? (
                    <Button variant="outline" size="sm" asChild>
                        <a href={productShopUrl(product)} target="_blank" rel="noopener noreferrer">
                            Open in shop
                            <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                    </Button>
                ) : null}
            </div>
            <ProductDetailView product={product} preview />
            {/* Wishlist / compare / add to cart toast; the office frame that used to
                host a Toaster is not around this page. */}
            <Toaster position="bottom-center" richColors closeButton />
        </main>
    );
}
