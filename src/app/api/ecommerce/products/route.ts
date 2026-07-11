import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { invProductToAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { resolveShopListing } from "@/modules/ecommerce/lib/shopListing";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { prismaUniqueError } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const specsSchema = z.record(z.string(), z.string()).optional();

const createSchema = z.object({
    // inventory fields
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(500),
    unitId: z.coerce.number().int().positive(),
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
    specs: specsSchema,
    stock: z.coerce.number().int().min(0).optional().nullable(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    isListedInShop: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    isActive: z.boolean().optional(),
});

const productInclude = {
    category: { select: { name: true } },
    brand: { select: { name: true } },
    group: { select: { name: true } },
} as const;

export async function GET(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const q = searchParams.get("q")?.trim();
        const shopCategory = searchParams.get("category")?.trim();
        const bands = await loadBarcodeBands();
        const products = await invProductDb(prisma).findMany({
            where: {
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { sku: { contains: q, mode: "insensitive" } },
                        { slug: { contains: q, mode: "insensitive" } },
                    ],
                } : {}),
                ...(shopCategory && shopCategory !== "all" ? { shopCategory } : {}),
            },
            include: productInclude,
            orderBy: [{ shopCategory: "asc" }, { id: "desc" }],
        });
        return NextResponse.json(products.map((p) => invProductToAdmin(p, bands)));
    } catch (e) {
        return handleApiError(e, "Failed to list products");
    }
}

export async function POST(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const b = data;
        const sku = b.sku.trim().toUpperCase();
        const existing = await prisma.invProduct.findUnique({ where: { sku } });
        if (existing) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });

        const galleryJson = b.galleryUrls && b.galleryUrls.length > 0 ? b.galleryUrls : undefined;
        const specsJson = b.specs && Object.keys(b.specs).length > 0 ? b.specs : undefined;
        const imageUrl = b.imageUrl && b.imageUrl !== "" ? b.imageUrl : galleryJson?.[0] ?? null;

        // Auto-qualify / auto-slug. A new product has no saved sale price yet, so
        // the qualification price falls back to the effective price (pricePaise).
        const [bands, rules] = await Promise.all([loadBarcodeBands(), loadShopPublishRules()]);
        const listing = resolveShopListing(
            {
                name: b.name,
                sku,
                imageUrl,
                galleryUrls: galleryJson ?? [],
                shopDescription: b.shopDescription ?? null,
                shopCategory: b.shopCategory ?? null,
                stock: b.stock === undefined ? null : b.stock,
                savedSalePricePaise: null,
                mrpPaise: b.mrpPaise ?? null,
                effectiveSalePricePaise: b.pricePaise ?? null,
                slug: b.slug?.trim() || null,
            },
            { explicitListed: b.isListedInShop, bands, rules }
        );
        if (!listing.ok) {
            return NextResponse.json(
                { error: `Cannot list in shop — missing: ${listing.missing.join(", ")}` },
                { status: 422 }
            );
        }

        const p = await invProductDb(prisma).create({
            data: {
                sku,
                name: b.name,
                unitId: b.unitId,
                categoryId: b.categoryId ?? null,
                groupId: b.groupId ?? null,
                brandId: b.brandId ?? null,
                warrantyTermId: b.warrantyTermId ?? null,
                slug: listing.slug,
                shopSubheading: b.shopSubheading ?? null,
                shopDescription: b.shopDescription ?? null,
                shopCategory: b.shopCategory ?? null,
                // Boundary: ecommerce admin sends `pricePaise`; map to the renamed column.
                effectiveSalePricePaise: b.pricePaise ?? null,
                mrpPaise: b.mrpPaise ?? null,
                shopBadge: b.shopBadge ?? null,
                imageUrl,
                galleryJson: galleryJson ?? undefined,
                specsJson: specsJson ?? undefined,
                stock: b.stock === undefined ? null : b.stock,
                lowStockThreshold: b.lowStockThreshold ?? 5,
                isListedInShop: listing.isListedInShop,
                allowBackorder: b.allowBackorder ?? false,
                isActive: b.isActive ?? true,
            },
            include: productInclude,
        });
        return NextResponse.json(invProductToAdmin(p, bands), { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "SKU or slug already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create product");
    }
}
