import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductToAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { prismaUniqueError } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
    isListedInShop: z.boolean().optional(),
    isActive: z.boolean().optional(),
});

const productInclude = { category: { select: { name: true } } } as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const p = await invProductDb(prisma).findUnique({ where: { id: pid }, include: productInclude });
        if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(invProductToAdmin(p));
    } catch (e) {
        return handleApiError(e, "Failed to load product");
    }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    const b = data;
    try {
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
        if (b.slug !== undefined) data.slug = b.slug?.trim() || null;
        if (b.shopSubheading !== undefined) data.shopSubheading = b.shopSubheading;
        if (b.shopDescription !== undefined) data.shopDescription = b.shopDescription;
        if (b.shopCategory !== undefined) data.shopCategory = b.shopCategory;
        if (b.pricePaise !== undefined) data.pricePaise = b.pricePaise;
        if (b.mrpPaise !== undefined) data.mrpPaise = b.mrpPaise;
        if (b.shopBadge !== undefined) data.shopBadge = b.shopBadge;
        if (b.imageUrl !== undefined) data.imageUrl = b.imageUrl && b.imageUrl !== "" ? b.imageUrl : null;
        if (galleryJson !== undefined) data.galleryJson = galleryJson;
        if (specsJson !== undefined) data.specsJson = specsJson;
        if (b.stock !== undefined) data.stock = b.stock;
        if (b.lowStockThreshold !== undefined) data.lowStockThreshold = b.lowStockThreshold;
        if (b.isListedInShop !== undefined) data.isListedInShop = b.isListedInShop;
        if (b.isActive !== undefined) data.isActive = b.isActive;

        const p = await invProductDb(prisma).update({
            where: { id: pid },
            data,
            include: productInclude,
        });
        return NextResponse.json(invProductToAdmin(p));
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "SKU or slug already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update product");
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
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
