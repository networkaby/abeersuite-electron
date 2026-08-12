import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { invProductToAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { resolveShopListing } from "@/modules/ecommerce/lib/shopListing";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { prismaUniqueError } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const patchSchema = z.object({
    // inventory fields
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    unitId: z.coerce.number().int().positive().optional(),
    categoryId: z.number().int().positive().nullish(),
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
    specs: z.record(z.string(), z.string()).optional(),
    stock: z.coerce.number().int().min(0).optional().nullable(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
    lengthCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    breadthCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    heightCm: z.coerce.number().int().min(0).max(1000).optional().nullable(),
    isListedInShop: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    isActive: z.boolean().optional(),
});

const productInclude = {
    category: { select: { name: true } },
    brand: { select: { name: true } },
    group: { select: { name: true } },
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const bands = await loadBarcodeBands();
        const p = await invProductDb(prisma).findUnique({ where: { id: pid }, include: productInclude });
        if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(invProductToAdmin(p, bands));
    } catch (e) {
        return handleApiError(e, "Failed to load product");
    }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    const b = data;
    try {
        const existing = await prisma.invProduct.findUnique({
            where: { id: pid },
            select: {
                name: true, sku: true, imageUrl: true, galleryJson: true,
                shopDescription: true, shopCategory: true, stock: true, savedSalePricePaise: true,
                mrpPaise: true, effectiveSalePricePaise: true, slug: true,
                groupId: true, brandId: true, allowBackorder: true, weightGrams: true, gstRateId: true,
            },
        });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const galleryJson =
            b.galleryUrls !== undefined
                ? b.galleryUrls.length > 0 ? b.galleryUrls : undefined
                : undefined;
        const specsJson =
            b.specs !== undefined
                ? Object.keys(b.specs).length > 0 ? b.specs : undefined
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
        if (b.stock !== undefined) data.stock = b.stock;
        if (b.lowStockThreshold !== undefined) data.lowStockThreshold = b.lowStockThreshold;
        if (b.weightGrams !== undefined) data.weightGrams = b.weightGrams;
        if (b.lengthCm !== undefined) data.lengthCm = b.lengthCm;
        if (b.breadthCm !== undefined) data.breadthCm = b.breadthCm;
        if (b.heightCm !== undefined) data.heightCm = b.heightCm;
        if (b.allowBackorder !== undefined) data.allowBackorder = b.allowBackorder;
        if (b.isActive !== undefined) data.isActive = b.isActive;

        // Resolve listing + slug from the merged (request ∪ existing) state.
        const existingGallery = Array.isArray(existing.galleryJson)
            ? (existing.galleryJson as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
        const [bands, rules] = await Promise.all([loadBarcodeBands(), loadShopPublishRules()]);
        const listing = resolveShopListing(
            {
                name: (data.name as string | undefined) ?? existing.name,
                sku: (data.sku as string | undefined) ?? existing.sku,
                imageUrl: (data.imageUrl as string | null | undefined) ?? existing.imageUrl,
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
                gstRateId: existing.gstRateId,
                savedSalePricePaise: existing.savedSalePricePaise,
                mrpPaise: b.mrpPaise !== undefined ? b.mrpPaise ?? null : existing.mrpPaise,
                effectiveSalePricePaise:
                    b.pricePaise !== undefined ? b.pricePaise ?? null : existing.effectiveSalePricePaise,
                slug: b.slug !== undefined ? b.slug?.trim() || null : existing.slug,
            },
            { explicitListed: b.isListedInShop, bands, rules }
        );
        if (!listing.ok) {
            return NextResponse.json(
                { error: `Cannot list in shop — missing: ${listing.missing.join(", ")}` },
                { status: 422 }
            );
        }
        data.isListedInShop = listing.isListedInShop;
        data.slug = listing.slug;

        const p = await invProductDb(prisma).update({
            where: { id: pid },
            data,
            include: productInclude,
        });
        return NextResponse.json(invProductToAdmin(p, bands));
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "SKU or slug already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update product");
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const p = await invProductDb(prisma).update({
            where: { id: pid },
            data: { isListedInShop: false, isActive: false },
            include: productInclude,
        });
        return NextResponse.json(invProductToAdmin(p));
    } catch (e) {
        return handleApiError(e, "Failed to deactivate product");
    }
}
