import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { shopProductToAdmin } from "@/modules/ecommerce/lib/product-admin";
import { z } from "zod";

const patchSchema = z.object({
    name: z.string().trim().min(1).optional(),
    slug: z.string().trim().min(1).optional().nullable(),
    subheading: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    category: z.string().trim().min(1).optional(),
    pricePaise: z.coerce.number().int().positive().optional(),
    mrpPaise: z.coerce.number().int().positive().optional().nullable(),
    badge: z.string().trim().optional().nullable(),
    imageUrl: z.string().url().optional().nullable().or(z.literal("")),
    galleryUrls: z.array(z.string().url()).optional(),
    specs: z.record(z.string(), z.string()).optional(),
    stock: z.coerce.number().int().min(0).optional().nullable(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const p = await prisma.shopProduct.findUnique({ where: { id: pid } });
        if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(shopProductToAdmin(p));
    } catch {
        return NextResponse.json({ error: "Failed to load product" }, { status: 500 });
    }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const b = parsed.data;
    try {
        const galleryJson =
            b.galleryUrls !== undefined
                ? b.galleryUrls.length > 0
                    ? b.galleryUrls
                    : undefined
                : undefined;
        const specsJson =
            b.specs !== undefined ? (Object.keys(b.specs).length > 0 ? b.specs : undefined) : undefined;

        const data: Record<string, unknown> = {};
        if (b.name !== undefined) data.name = b.name;
        if (b.slug !== undefined) data.slug = b.slug?.trim() || null;
        if (b.subheading !== undefined) data.subheading = b.subheading;
        if (b.description !== undefined) data.description = b.description;
        if (b.category !== undefined) data.category = b.category;
        if (b.pricePaise !== undefined) data.pricePaise = b.pricePaise;
        if (b.mrpPaise !== undefined) data.mrpPaise = b.mrpPaise;
        if (b.badge !== undefined) data.badge = b.badge;
        if (b.imageUrl !== undefined) data.imageUrl = b.imageUrl && b.imageUrl !== "" ? b.imageUrl : null;
        if (galleryJson !== undefined) data.galleryJson = galleryJson;
        if (specsJson !== undefined) data.specsJson = specsJson;
        if (b.stock !== undefined) data.stock = b.stock;
        if (b.lowStockThreshold !== undefined) data.lowStockThreshold = b.lowStockThreshold;
        if (b.isActive !== undefined) data.isActive = b.isActive;

        const p = await prisma.shopProduct.update({
            where: { id: pid },
            data,
        });
        return NextResponse.json(shopProductToAdmin(p));
    } catch {
        return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const p = await prisma.shopProduct.update({
            where: { id: pid },
            data: { isActive: false },
        });
        return NextResponse.json(shopProductToAdmin(p));
    } catch {
        return NextResponse.json({ error: "Failed to deactivate product" }, { status: 500 });
    }
}
