import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { aiErrorMessage, generateProductCopy, isAiConfigured } from "@/modules/ecommerce/lib/aiProductCopy";

// AI product copy (Gemini + Google Search). Nothing is written here — the
// caller shows the draft and saves through the normal product PATCH, so staff
// always review before a customer sees it.
//
// GET  ?cursor=&take=  → active products with no shop description (bulk backlog)
// POST { productId, name?, imageUrl?, search } → one draft

async function guard() {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return { response };
    if (!hasPermission(user, PERMISSIONS.ECOMMERCE_AI_COPY)) {
        return { response: NextResponse.json({ error: "You need the 'Generate product copy with AI' tick" }, { status: 403 }) };
    }
    if (!isAiConfigured()) {
        return { response: NextResponse.json({ error: "AI is not set up — add GOOGLE_GENERATIVE_AI_API_KEY to .env" }, { status: 503 }) };
    }
    return { response: null };
}

const missingDescription = {
    isActive: true,
    OR: [{ shopDescription: null }, { shopDescription: "" }],
};

export async function GET(req: Request) {
    const { response } = await guard();
    if (response) return response;
    const url = new URL(req.url);
    const cursor = Number(url.searchParams.get("cursor")) || undefined;
    const take = Math.min(Math.max(Number(url.searchParams.get("take")) || 50, 1), 200);
    try {
        const [rows, total] = await Promise.all([
            prisma.invProduct.findMany({
                where: missingDescription,
                select: { id: true, sku: true, name: true, imageUrl: true, shopSubheading: true, specsJson: true, brand: { select: { name: true } } },
                orderBy: { id: "asc" },
                take,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
            prisma.invProduct.count({ where: missingDescription }),
        ]);
        return NextResponse.json({
            total,
            items: rows.map((r) => ({
                id: r.id, sku: r.sku, name: r.name, imageUrl: r.imageUrl, brand: r.brand?.name ?? null,
                subheading: r.shopSubheading,
                specs: r.specsJson && typeof r.specsJson === "object" && !Array.isArray(r.specsJson)
                    ? (r.specsJson as Record<string, string>) : {},
            })),
            nextCursor: rows.length === take ? rows[rows.length - 1].id : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}

const postSchema = z.object({
    productId: z.number().int().positive(),
    // Unsaved edits from the form win over the saved row.
    name: z.string().trim().min(1).max(500).optional(),
    imageUrl: z.string().url().nullish(),
    search: z.boolean().default(false),
});

export async function POST(req: Request) {
    const { response } = await guard();
    if (response) return response;
    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;
    try {
        const p = await prisma.invProduct.findUnique({
            where: { id: data.productId },
            select: {
                name: true, imageUrl: true, shopCategory: true,
                brand: { select: { name: true } }, category: { select: { name: true } },
            },
        });
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        const copy = await generateProductCopy({
            name: data.name ?? p.name,
            brand: p.brand?.name,
            category: p.shopCategory ?? p.category?.name,
            imageUrl: data.imageUrl === undefined ? p.imageUrl : data.imageUrl,
            search: data.search,
        });
        return NextResponse.json(copy);
    } catch (e) {
        const reason = aiErrorMessage(e);
        if (reason) return NextResponse.json({ error: reason }, { status: 503 });
        return handleApiError(e, "AI could not write this product");
    }
}
