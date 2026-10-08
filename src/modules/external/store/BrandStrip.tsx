import BrandStripView from "./BrandStripView";
import { loadShopBrands } from "@/shared/lib/shop/shopBrands";

/**
 * Storefront brand strip — fetches the active, logo-bearing brands and hands
 * them to BrandStripView, which owns the markup (and is reused by the
 * Customize Home live preview).
 */
export default async function BrandStrip({
    eyebrow,
    title,
}: {
    eyebrow?: string;
    title?: string;
} = {}) {
    const brands = await loadShopBrands();
    return <BrandStripView brands={brands} eyebrow={eyebrow} title={title} />;
}
