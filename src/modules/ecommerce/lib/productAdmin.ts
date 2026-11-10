import type { InvProduct } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";

/**
 * What a product in the DRAFT stage carries beside its fields
 * (InvProduct.shopDraftJson). Draft is a stage on the one product row (owner,
 * 2026-11-10: "only one copy no parallel") — this is never a second copy.
 */
export type ShopDraft = {
    /** The stage it was in before Save as draft — Discard draft goes back to it. */
    stageBefore?: ShopStatus;
    /** Claude's Verified copy: already written onto the product; kept for its notes and photo advice. */
    aiCopy?: ProductCopy;
    /** Review notes (Claude's review mode, /api/agent/products/[id]/notes) — things for staff to fix. */
    notes?: string[];
};

export function readShopDraft(raw: unknown): ShopDraft | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as { stageBefore?: unknown; aiCopy?: unknown; notes?: unknown };
    const notes = Array.isArray(r.notes) ? r.notes.filter((x): x is string => typeof x === "string") : [];
    const stages: unknown[] = ["UNPUBLISHED", "READY", "PUBLISHED"];
    return {
        ...(stages.includes(r.stageBefore) ? { stageBefore: r.stageBefore as ShopStatus } : {}),
        ...(r.aiCopy && typeof r.aiCopy === "object" ? { aiCopy: r.aiCopy as ProductCopy } : {}),
        ...(notes.length ? { notes } : {}),
    };
}
import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { readPhotoChecklist, type PhotoChecklist } from "@/modules/ecommerce/lib/photoChecklist";

/** Admin shape — storefront fields + inventory + stock management. */
export type ShopProductAdmin = ShopProductPublic & {
    sku: string;
    stock: number | null;
    lowStockThreshold: number;
    isActive: boolean;
    /** Live in the shop right now (PUBLISHED and the publish rules met). */
    isListedInShop: boolean;
    /** Stage: UNPUBLISHED → READY → PUBLISHED ("Pending" = PUBLISHED, not live). */
    shopStatus: ShopStatus;
    /** When it was last saved as draft or Claude wrote on it (null = not in Draft). */
    shopDraftAt: string | null;
    /** Needs attention: the problem staff or Claude found (null = none). Beside any stage. */
    shopAttention: string | null;
    shopAttentionAt: string | null;
    shopAttentionBy: string | null;
    /** Stage-before + Claude's notes — only the product's own page gets it (withShopDraft). */
    shopDraft?: ShopDraft | null;
    /** Per-product override: accept orders even at zero stock (backorder). */
    allowBackorder: boolean;
    unitId: number;
    categoryId: number | null;
    /** Every collection id, main first (InvProductCollection). */
    collectionIds: number[];
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    /** Shipping weight of one unit in grams (null = unset → quote uses fallback). */
    weightGrams: number | null;
    /** Parcel dimensions of one unit (cm) — drive volumetric weight. */
    lengthCm: number | null;
    breadthCm: number | null;
    heightCm: number | null;
    /** Resolved brand / product-group display names (null when unset). */
    brandName: string | null;
    groupName: string | null;
    /** Raw explicit storefront category (null when unset) — for the publish gate. */
    shopCategory: string | null;
    // Display-only: the human saved sale price and the derived barcode tag price
    // (what the storefront actually charges). The editable `pricePaise` above
    // stays the effective/strategy price so the form round-trips it unchanged.
    savedSalePricePaise: number | null;
    barcodePricePaise: number | null;
    /** Every scannable code on the product (barcode + EAN + UPC) — search only. */
    codes: { kind: string; value: string }[];
    /** Photo checklist under Product image (null = never checked). */
    photoChecklist: PhotoChecklist | null;
    /** Attributes a sibling variant has filled and this one has not ("Colour").
     *  Filled in by the admin routes (loadVariantAttrGaps); absent = none. */
    variantAttrGaps?: string[];
};

export function invProductToAdmin(
    p: Omit<InvProduct, "shopDraftJson"> & {
        category?: { name: string } | null;
        brand?: { name: string } | null;
        group?: { name: string } | null;
        codes?: { kind: string; value: string }[];
        collections?: { categoryId: number; category: { name: string } }[];
    },
    bands?: BarcodeBand[]
): ShopProductAdmin {
    // No bands → editable `pricePaise` keeps the effective price (round-trip safe).
    const pub = invProductToPublic(p);
    return {
        ...pub,
        // "Category" here IS the office product group, renamed for the shop on
        // purpose: the office follows Tally (stock groups; GST set group-wise), the
        // shop uses the e-commerce word customers know. See docs/vocabulary.md.
        // Mirror the storefront rule (shopCategory ?? group, else blank) so the
        // admin Category column reads the same as the live shop. The admin row has
        // only the product's DIRECT group, not the root — close enough here, and the
        // separate Group filter already exposes the real group. Storefront truth
        // lives in invProductToPublic + loadShopGroupRoots.
        category: p.shopCategory ?? p.group?.name ?? "",
        sku: p.sku,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        isActive: p.isActive,
        isListedInShop: p.isListedInShop,
        shopStatus: p.shopStatus,
        shopDraftAt: p.shopDraftAt?.toISOString() ?? null,
        shopAttention: p.shopAttention ?? null,
        shopAttentionAt: p.shopAttentionAt?.toISOString() ?? null,
        shopAttentionBy: p.shopAttentionBy ?? null,
        allowBackorder: p.allowBackorder,
        unitId: p.unitId,
        categoryId: p.categoryId,
        collectionIds: p.collections?.length
            ? p.collections.map((c) => c.categoryId)
            : p.categoryId != null ? [p.categoryId] : [],
        groupId: p.groupId,
        brandId: p.brandId,
        warrantyTermId: p.warrantyTermId,
        weightGrams: p.weightGrams ?? null,
        lengthCm: p.lengthCm ?? null,
        breadthCm: p.breadthCm ?? null,
        heightCm: p.heightCm ?? null,
        brandName: p.brand?.name ?? null,
        groupName: p.group?.name ?? null,
        shopCategory: p.shopCategory,
        savedSalePricePaise: p.savedSalePricePaise,
        barcodePricePaise: bands ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands, p.barcodeManualPaise) : null,
        codes: p.codes ?? [],
        photoChecklist: readPhotoChecklist(p.photoChecklistJson),
    };
}

/** The admin row plus its draft copy — for the product's own page only (lists skip the JSON). */
export function withShopDraft(
    p: InvProduct & Parameters<typeof invProductToAdmin>[0],
    bands?: BarcodeBand[],
): ShopProductAdmin {
    return { ...invProductToAdmin(p, bands), shopDraft: readShopDraft(p.shopDraftJson) };
}

