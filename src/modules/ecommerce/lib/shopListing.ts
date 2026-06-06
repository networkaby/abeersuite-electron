import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import {
    shopQualification,
    slugifyProduct,
    DEFAULT_SHOP_PUBLISH_RULES,
    type ShopPublishRules,
} from "@/modules/ecommerce/lib/shopQualification";

/** Merged product fields (request ∪ existing row) needed to decide shop listing. */
export type ShopListingInput = {
    name: string;
    sku: string;
    imageUrl: string | null;
    galleryUrls: string[];
    shopDescription: string | null;
    shopCategory: string | null;
    stock: number | null;
    savedSalePricePaise: number | null;
    mrpPaise: number | null;
    effectiveSalePricePaise: number | null;
    slug: string | null;
};

export type ShopListingDecision =
    | { ok: true; isListedInShop: boolean; slug: string | null }
    | { ok: false; missing: string[] };

/**
 * Decide whether a product is listed in the shop and what its slug is.
 *
 * - `explicitListed === undefined` (caller didn't touch the switch): **auto-qualify**
 *   — list iff the product meets the shop-readiness bar.
 * - `explicitListed === true`: caller wants it live — allowed only when qualified,
 *   otherwise returns the missing requirements (caller should 422).
 * - `explicitListed === false`: always unlist (manual override).
 *
 * When the result is listed and no slug is set, one is auto-generated from the
 * name + SKU. The shop price used for the qualification gate is the barcode tag
 * (saved price + MRP) with an effective-price fallback — matching what the
 * storefront actually charges.
 */
export function resolveShopListing(
    m: ShopListingInput,
    opts: { explicitListed?: boolean; bands: BarcodeBand[]; rules?: ShopPublishRules }
): ShopListingDecision {
    const shopPrice =
        barcodeTagPaise(m.savedSalePricePaise, m.mrpPaise, opts.bands) ??
        m.effectiveSalePricePaise ??
        0;
    const q = shopQualification(
        {
            pricePaise: shopPrice,
            imageUrl: m.imageUrl,
            galleryUrls: m.galleryUrls,
            description: m.shopDescription,
            category: m.shopCategory,
            mrpPaise: m.mrpPaise,
            stock: m.stock,
        },
        opts.rules ?? DEFAULT_SHOP_PUBLISH_RULES
    );

    let isListedInShop: boolean;
    if (opts.explicitListed === undefined) {
        isListedInShop = q.qualified;
    } else if (opts.explicitListed && !q.qualified) {
        return { ok: false, missing: q.missing };
    } else {
        isListedInShop = opts.explicitListed;
    }

    const slug = m.slug?.trim() || (isListedInShop ? slugifyProduct(m.name, m.sku) : null);
    return { ok: true, isListedInShop, slug };
}
