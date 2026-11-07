import { NextResponse } from "next/server";
import { shopSlugClash } from "@/shared/lib/shop/shopSlug";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, prismaUniqueError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { invProductToAdmin, type ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { nextShopStatus, resolveShopListing, SHOP_STATUSES } from "@/modules/ecommerce/lib/shopListing";
import { PHOTO_KIND_KEYS } from "@/modules/ecommerce/lib/photoChecklist";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { mergeGallery } from "@/modules/ecommerce/lib/mergeGallery";
import { collectionsExist, setProductCollections, syncMainCollections } from "@/modules/inventory/lib/productCollections";

export const shopProductPatchSchema = z.object({
    // inventory fields
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    unitId: z.coerce.number().int().positive().optional(),
    categoryId: z.number().int().positive().nullish(),
    /** Every collection, main first — wins over categoryId (productCollections.ts). */
    collectionIds: z.array(z.number().int().positive()).max(50).optional(),
    groupId: z.number().int().positive().nullish(),
    brandId: z.number().int().positive().nullish(),
    warrantyTermId: z.number().int().positive().nullish(),
    // ecommerce fields
    slug: z.string().trim().min(1).optional().nullable(),
    shopSubheading: z.string().trim().optional().nullable(),
    shopDescription: z.string().trim().optional().nullable(),
    shopCategory: z.string().trim().min(1).optional().nullable(),
    pricePaise: z.coerce.number().int().positive().optional().nullable(),
    mrpPaise: z.coerce.number().int().positive().optional().nullable(),
    shopBadge: z.string().trim().optional().nullable(),
    imageUrl: z.string().url().optional().nullable().or(z.literal("")),
    galleryUrls: z.array(z.string().url()).optional(),
    // The saved list the editor started from. When sent, galleryUrls is merged
    // onto the gallery as saved now (mergeGallery.ts), so a photo added elsewhere
    // meanwhile — the phone app — is never dropped.
    galleryBase: z.array(z.string().url()).optional(),
    specs: z.record(z.string(), z.string()).optional(),
    // Photo checklist under Product image (photoChecklist.ts); null clears it.
    photoChecklist: z.object({
        items: z.array(z.object({ kind: z.enum(PHOTO_KIND_KEYS as [string, ...string[]]), done: z.boolean(), must: z.boolean().default(false) })).max(PHOTO_KIND_KEYS.length),
        enough: z.boolean(),
        at: z.string().max(40),
        remove: z.array(z.object({ url: z.string().url(), why: z.enum(["duplicate", "irrelevant", "quality"]), note: z.string().max(200) })).max(30).default([]),
    }).nullable().optional(),
    stock: z.coerce.number().int().min(0).optional().nullable(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
    lengthCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    breadthCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    heightCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    /** Old switch (a tab opened before shopStatus) — on = publish, off = back to Unpublished. */
    isListedInShop: z.boolean().optional(),
    /** Publish / Unpublish buttons. Left out, a save of an UNPUBLISHED product makes it DRAFT. */
    shopStatus: z.enum(SHOP_STATUSES).optional(),
    /** Staff used or discarded Claude's draft — clear it. */
    clearCopyDraft: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    isActive: z.boolean().optional(),
});
export type ShopProductPatch = z.infer<typeof shopProductPatchSchema>;

export const shopProductInclude = {
    category: { select: { name: true } },
    brand: { select: { name: true } },
    group: { select: { name: true } },
    collections: { select: { categoryId: true, category: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
} as const;

/**
 * The one write path for a product's shop fields — the office product page
 * (`PATCH /api/ecommerce/products/[id]`) and the phone app's Photos screen
 * (`/api/mobile/photos/product/[id]`) both save through here, so the listing and
 * slug rules can never differ between them.
 *
 * Merges the request over the saved row, moves the shop stage (`nextShopStatus`:
 * any save of an UNPUBLISHED product makes it DRAFT), re-decides `isListedInShop`
 * + `slug` (`resolveShopListing`: live = PUBLISHED and the rules met, else
 * Pending), and writes. Returns the admin row, or the response to send instead
 * (404, 409 duplicate).
 */
export async function updateShopProduct(
    pid: number,
    b: ShopProductPatch,
): Promise<{ product: ShopProductAdmin; response?: undefined } | { response: NextResponse }> {
    try {
        const existing = await prisma.invProduct.findUnique({
            where: { id: pid },
            select: {
                name: true, sku: true, imageUrl: true, galleryJson: true,
                shopDescription: true, shopCategory: true, stock: true, savedSalePricePaise: true, barcodeManualPaise: true,
                mrpPaise: true, effectiveSalePricePaise: true, slug: true,
                groupId: true, brandId: true, allowBackorder: true, weightGrams: true, shopStatus: true,
            },
        });
        if (!existing) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
        if (b.collectionIds && !(await collectionsExist(b.collectionIds))) {
            return { response: NextResponse.json({ error: "Collection not found" }, { status: 400 }) };
        }

        if (b.galleryUrls !== undefined && b.galleryBase !== undefined) {
            const merged = mergeGallery(b.galleryBase, b.galleryUrls, productGalleryUrls(existing.galleryJson, existing.imageUrl));
            b = { ...b, galleryUrls: merged, imageUrl: merged[0] ?? null };
        }

        // An empty list CLEARS the column. It used to mean "leave it", so the last
        // photo (or the last spec) could not be removed: the row kept it and the
        // next load showed it again.
        const galleryJson =
            b.galleryUrls !== undefined
                ? b.galleryUrls.length > 0 ? b.galleryUrls : Prisma.DbNull
                : undefined;
        const specsJson =
            b.specs !== undefined
                ? Object.keys(b.specs).length > 0 ? b.specs : Prisma.DbNull
                : undefined;

        const data: Record<string, unknown> = {};
        if (b.sku !== undefined) data.sku = b.sku.trim().toUpperCase();
        if (b.name !== undefined) data.name = b.name;
        if (b.unitId !== undefined) data.unitId = b.unitId;
        if (b.categoryId !== undefined) data.categoryId = b.categoryId;
        if (b.groupId !== undefined) data.groupId = b.groupId;
        if (b.brandId !== undefined) data.brandId = b.brandId;
        if (b.warrantyTermId !== undefined) data.warrantyTermId = b.warrantyTermId;
        if (b.shopSubheading !== undefined) data.shopSubheading = b.shopSubheading;
        if (b.shopDescription !== undefined) data.shopDescription = b.shopDescription;
        if (b.shopCategory !== undefined) data.shopCategory = b.shopCategory;
        // Boundary: ecommerce admin sends `pricePaise`; map to the renamed column.
        if (b.pricePaise !== undefined) data.effectiveSalePricePaise = b.pricePaise;
        if (b.mrpPaise !== undefined) data.mrpPaise = b.mrpPaise;
        if (b.shopBadge !== undefined) data.shopBadge = b.shopBadge;
        if (b.imageUrl !== undefined) data.imageUrl = b.imageUrl && b.imageUrl !== "" ? b.imageUrl : null;
        if (galleryJson !== undefined) data.galleryJson = galleryJson;
        if (specsJson !== undefined) data.specsJson = specsJson;
        if (b.photoChecklist !== undefined) data.photoChecklistJson = b.photoChecklist ?? Prisma.DbNull;
        if (b.stock !== undefined) data.stock = b.stock;
        if (b.lowStockThreshold !== undefined) data.lowStockThreshold = b.lowStockThreshold;
        if (b.weightGrams !== undefined) data.weightGrams = b.weightGrams;
        if (b.lengthCm !== undefined) data.lengthCm = b.lengthCm;
        if (b.breadthCm !== undefined) data.breadthCm = b.breadthCm;
        if (b.heightCm !== undefined) data.heightCm = b.heightCm;
        if (b.allowBackorder !== undefined) data.allowBackorder = b.allowBackorder;
        if (b.isActive !== undefined) data.isActive = b.isActive;
        if (b.clearCopyDraft) data.copyDraftJson = Prisma.DbNull;
        const shopStatus = nextShopStatus(existing.shopStatus, { status: b.shopStatus, listed: b.isListedInShop });
        data.shopStatus = shopStatus;

        // Resolve listing + slug from the merged (request ∪ existing) state.
        const existingGallery = Array.isArray(existing.galleryJson)
            ? (existing.galleryJson as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
        const [bands, rules] = await Promise.all([loadBarcodeBands(), loadShopPublishRules()]);
        const listing = resolveShopListing(
            {
                name: (data.name as string | undefined) ?? existing.name,
                sku: (data.sku as string | undefined) ?? existing.sku,
                // `!== undefined`, not `??`: a cleared image (null) must not fall back
                // to the saved one, or removing the last photo left the product listed.
                imageUrl: data.imageUrl !== undefined ? (data.imageUrl as string | null) : existing.imageUrl,
                galleryUrls: b.galleryUrls !== undefined ? b.galleryUrls : existingGallery,
                shopDescription:
                    b.shopDescription !== undefined ? b.shopDescription ?? null : existing.shopDescription,
                shopCategory:
                    b.shopCategory !== undefined ? b.shopCategory ?? null : existing.shopCategory,
                groupId: b.groupId !== undefined ? b.groupId ?? null : existing.groupId,
                brandId: b.brandId !== undefined ? b.brandId ?? null : existing.brandId,
                stock: b.stock !== undefined ? b.stock ?? null : existing.stock,
                allowBackorder:
                    b.allowBackorder !== undefined ? b.allowBackorder : existing.allowBackorder,
                weightGrams:
                    b.weightGrams !== undefined ? b.weightGrams ?? null : existing.weightGrams,
                savedSalePricePaise: existing.savedSalePricePaise,
                mrpPaise: b.mrpPaise !== undefined ? b.mrpPaise ?? null : existing.mrpPaise,
                effectiveSalePricePaise:
                    b.pricePaise !== undefined ? b.pricePaise ?? null : existing.effectiveSalePricePaise,
                slug: b.slug !== undefined ? b.slug?.trim() || null : existing.slug,
            },
            { status: shopStatus, bands, rules }
        );
        data.isListedInShop = listing.isListedInShop;
        data.slug = listing.slug;
        if (listing.slug) {
            const clash = await shopSlugClash(listing.slug, { kind: "product", id: pid });
            if (clash) return { response: NextResponse.json({ error: clash }, { status: 409 }) };
        }

        const p = await prisma.$transaction(async (tx) => {
            const row = await tx.invProduct.update({ where: { id: pid }, data, include: shopProductInclude });
            if (b.collectionIds === undefined && b.categoryId === undefined) return row;
            // Collections go through the one write path (productCollections.ts);
            // a lone categoryId moves the main one and keeps the extras.
            if (b.collectionIds !== undefined) await setProductCollections(tx, pid, b.collectionIds);
            else await syncMainCollections(tx, [pid]);
            return tx.invProduct.findUniqueOrThrow({ where: { id: pid }, include: shopProductInclude });
        });
        return { product: invProductToAdmin(p, bands) };
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "SKU or slug already exists");
        if (conflict) return { response: conflict };
        return { response: handleApiError(e, "Failed to update product") };
    }
}
