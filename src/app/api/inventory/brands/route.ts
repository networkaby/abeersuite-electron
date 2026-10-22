import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { shopSlugClash } from "@/shared/lib/shop/shopSlug";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { invBrandCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // ?withProducts=1 — storefront-facing callers (brand strip, its
        // Customize Home preview) only want brands that actually have
        // something to show; admin pickers/masters want the full list.
        const withProducts = new URL(req.url).searchParams.get("withProducts") === "1";
        const rows = await prisma.invBrand.findMany({
            where: withProducts ? { products: { some: { isListedInShop: true, isActive: true } } } : undefined,
            orderBy: { name: "asc" },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch brands");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invBrandCreateSchema);
        if (error) return error;
        const b = data;
        if (b.slug) {
            const clash = await shopSlugClash(b.slug, { kind: "brand" });
            if (clash) return NextResponse.json({ error: clash }, { status: 409 });
        }
        const row = await prisma.invBrand.create({
            data: {
                name: b.name,
                isActive: b.isActive ?? true,
                slug: b.slug ?? null,
                imageUrl: b.imageUrl ?? null,
                description: b.description ?? null,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Brand name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create brand");
    }
}
