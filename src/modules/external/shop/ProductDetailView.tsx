import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductGallery from "@/modules/external/shop/ProductGallery";
import ProductPurchasePanel from "@/modules/external/shop/ProductPurchasePanel";
import ProductDetailTabs from "@/modules/external/shop/ProductDetailTabs";
import type { VariantOption } from "@/shared/lib/shop/variants";

/**
 * The body of a product page — photos, price and cart panel, description and
 * specs. Drawn by the shop's product page and by the office's full-page preview,
 * so staff preview exactly what a customer will see.
 */
export default function ProductDetailView({
    product,
    preview = false,
    variants = [],
}: {
    product: ShopProductPublic;
    /** Office preview: the panel leaves out links into the shop (see ProductPurchasePanel). */
    preview?: boolean;
    /** Option buttons — the product's variant family (lib/shop/variants.ts). */
    variants?: VariantOption[];
}) {
    return (
        <>
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-12 items-start">
                <ProductGallery urls={product.galleryUrls} alt={product.displayName} />
                <ProductPurchasePanel product={product} preview={preview} variants={variants} />
            </div>

            <ProductDetailTabs product={product} />
        </>
    );
}
