import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { aiErrorMessage, generateProductCopy, isAiConfigured } from "@/modules/ecommerce/lib/aiProductCopy";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";

// AI product copy (Gemini + Google Search). Nothing is written here — the
// caller shows the draft and saves through the normal product PATCH, so staff
// always review before a customer sees it.
//
// The bulk screen lists its backlog from GET /api/ecommerce/products (shared
// filters and cache with Products), so this route only drafts.
// POST { productId, name?, imageUrls?, search: off|auto|always } → one draft (+ version A when search changed it) (photos marked "Skip for AI" are not sent)

async function guard() {
    // Anyone who can open E-Commerce may use it — owner's call, no tick of its own.
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return { response };
    if (!isAiConfigured()) {
        return { response: NextResponse.json({ error: "AI is not set up — add GOOGLE_GENERATIVE_AI_API_KEY to .env" }, { status: 503 }) };
    }
    return { response: null };
}

const postSchema = z.object({
    productId: z.number().int().positive(),
    // Unsaved edits from the form win over the saved row.
    name: z.string().trim().min(1).max(500).optional(),
    // The form's current (possibly unsaved) gallery, skip marks included.
    imageUrls: z.array(z.string().url()).max(30).optional(),
    // true/false from a tab opened before the three modes existed.
    search: z.union([z.boolean().transform((b) => (b ? "auto" : "off")), z.enum(["off", "auto", "always"])]).default("off"),
    // Bulk screen: may wait a few seconds for a free key rather than use the paid one.
    bulk: z.boolean().default(false),
    // "Use Premium API" — off (default, also for an old tab) never touches the paid key.
    premium: z.boolean().default(false),
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
                name: true, imageUrl: true, galleryJson: true, shopCategory: true,
                brand: { select: { name: true } }, category: { select: { name: true } },
                warrantyTerm: { select: { durationDays: true } },
            },
        });
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        const copy = await generateProductCopy({
            name: data.name ?? p.name,
            brand: p.brand?.name,
            category: p.shopCategory ?? p.category?.name,
            shopWarrantyDays: p.warrantyTerm?.durationDays,
            imageUrls: photosForAi(data.imageUrls ?? productGalleryUrls(p.galleryJson, p.imageUrl)),
            search: data.search,
            bulk: data.bulk,
            premium: data.premium,
        });
        return NextResponse.json(copy);
    } catch (e) {
        const reason = aiErrorMessage(e);
        if (reason) return NextResponse.json({ error: reason }, { status: 503 });
        return handleApiError(e, "AI could not write this product");
    }
}
