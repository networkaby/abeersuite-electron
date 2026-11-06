import BrandStripView from "./BrandStripView";
import { loadShopBrands } from "@/shared/lib/shop/shopBrands";
import { dailyPick } from "@/shared/lib/shop/browseTiles";

/**
 * Storefront brand strip — fetches the active, logo-bearing brands and hands
 * them to BrandStripView, which owns the markup (and is reused by the
 * Customize Home live preview).
 */
export default async function BrandStrip({
    eyebrow,
    title,
    limit,
    todayIso,
}: {
    eyebrow?: string;
    title?: string;
    /** Show only this many (a daily rotation) with an "All brands" link. */
    limit?: number;
    todayIso?: string;
} = {}) {
    const brands = await loadShopBrands();
    if (limit == null || brands.length <= limit) return <BrandStripView brands={brands} eyebrow={eyebrow} title={title} />;
    const picked = dailyPick(brands, limit, todayIso ?? "", "brands", 0);
    return <BrandStripView brands={picked} eyebrow={eyebrow} title={title} moreHref="/shop?view=brands" />;
}
