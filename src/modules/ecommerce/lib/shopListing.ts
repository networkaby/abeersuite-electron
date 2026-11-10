import type { ShopStatus } from "@/generated/prisma/enums";
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
    groupId: number | null;
    brandId: number | null;
    stock: number | null;
    allowBackorder: boolean;
    weightGrams: number | null;
    savedSalePricePaise: number | null;
    barcodeManualPaise?: number | null;
    mrpPaise: number | null;
    effectiveSalePricePaise: number | null;
    slug: string | null;
    /** Sibling attributes still empty here (loadVariantAttrGaps). */
    variantAttrGaps?: string[];
};

/** Stages staff can choose, for zod. */
export const SHOP_STATUSES = ["UNPUBLISHED", "DRAFT", "READY", "PUBLISHED"] as const satisfies readonly ShopStatus[];

export type ShopListingDecision = {
    /** Live in the shop right now: PUBLISHED and the publish rules met. */
    isListedInShop: boolean;
    slug: string | null;
    /** Publish rules still unmet — a PUBLISHED product with any is "Pending". */
    missing: string[];
};

/**
 * The product's next stage: Unpublished → Draft → Ready → Published (Pending =
 * published, a rule unmet). Draft is a stage on the one product row (owner,
 * 2026-11-10). Staff's choice wins; a plain save keeps the stage — a Published
 * product saved plainly is edited live.
 * `listed` is the old switch (a tab opened before stages): on = publish, off =
 * Unpublish, which goes to READY — the work on it is finished.
 */
export function nextShopStatus(current: ShopStatus, o: { status?: ShopStatus; listed?: boolean }): ShopStatus {
    if (o.status) return o.status;
    if (o.listed === true) return "PUBLISHED";
    if (o.listed === false && current === "PUBLISHED") return "READY";
    return current;
}

/**
 * Whether a product is live in the shop and what its slug is. Never refuses:
 * PUBLISHED with a rule unmet is "Pending" (hidden, with the missing list) and
 * goes live by itself on the save that meets the rules. Only PUBLISHED can be live.
 *
 * When the result is live and no slug is set, one is generated from the name +
 * SKU. The shop price used for the gate is the barcode tag (saved price + MRP)
 * with an effective-price fallback — what the storefront actually charges.
 */
export function resolveShopListing(
    m: ShopListingInput,
    opts: { status: ShopStatus; bands: BarcodeBand[]; rules?: ShopPublishRules }
): ShopListingDecision {
    const shopPrice =
        barcodeTagPaise(m.savedSalePricePaise, m.mrpPaise, opts.bands, m.barcodeManualPaise) ??
        m.effectiveSalePricePaise ??
        0;
    const q = shopQualification(
        {
            pricePaise: shopPrice,
            imageUrl: m.imageUrl,
            galleryUrls: m.galleryUrls,
            description: m.shopDescription,
            category: m.shopCategory,
            groupId: m.groupId,
            brandId: m.brandId,
            mrpPaise: m.mrpPaise,
            stock: m.stock,
            allowBackorder: m.allowBackorder,
            weightGrams: m.weightGrams,
            // Always judged on a save: no family → no gaps.
            variantAttrGaps: m.variantAttrGaps ?? [],
        },
        opts.rules ?? DEFAULT_SHOP_PUBLISH_RULES
    );
    const isListedInShop = opts.status === "PUBLISHED" && q.qualified;
    const slug = m.slug?.trim() || (isListedInShop ? slugifyProduct(m.name, m.sku) : null);
    return { isListedInShop, slug, missing: q.missing };
}
