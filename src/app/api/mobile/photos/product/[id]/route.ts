import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MAX_PRODUCT_PHOTOS } from "@/shared/lib/constants/inventory";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { updateShopProduct } from "@/modules/ecommerce/lib/updateShopProduct";
import { isOwnPhotoUrl } from "@/modules/mobile/lib/shopPhotos";
import { setAiSkipped } from "@/shared/lib/shop/photoMark";
import type { ProductPhotos } from "@/modules/mobile/lib/types";

// GET   /api/mobile/photos/product/[id] — one product's shop photos, main first.
// PATCH /api/mobile/photos/product/[id] — one change to them:
//   { add: [url, …] }   append newly uploaded photos (the first photo becomes main)
//   { remove: url }     take one off
//   { makeMain: url }   move one to the front
//   { aiSkip: url, skip } mark / unmark "Skip for AI" (a #ai-skip on the URL — photoMark.ts)
//
// The change is applied to the gallery as saved NOW, not to the list the phone
// last saw, so an office edit made meanwhile is never overwritten. It is written
// through updateShopProduct — the office product page's own save — so a photo
// that makes the product shop-ready lists it, and removing the last one unlists
// it, exactly as on the office page.

const opSchema = z.union([
    z.object({ add: z.array(z.string().url()).min(1).max(MAX_PRODUCT_PHOTOS) }).strict(),
    z.object({ remove: z.string().url() }).strict(),
    z.object({ makeMain: z.string().url() }).strict(),
    z.object({ aiSkip: z.string().url(), skip: z.boolean() }).strict(),
]);

const select = { id: true, name: true, sku: true, galleryJson: true, imageUrl: true, isListedInShop: true } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    if (response) return response;
    const { id, error } = await parseIdParam(params);
    if (error) return error;
    try {
        const p = await prisma.invProduct.findUnique({ where: { id }, select });
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        const body: ProductPhotos = {
            id: p.id,
            name: p.name,
            sku: p.sku,
            galleryUrls: productGalleryUrls(p.galleryJson, p.imageUrl),
            isListedInShop: p.isListedInShop,
        };
        return NextResponse.json(body);
    } catch (e) {
        return handleApiError(e, "Could not load the product's photos");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    if (response) return response;
    const { id, error } = await parseIdParam(params);
    if (error) return error;
    const { data: op, error: bodyError } = await validateRequest(req, opSchema);
    if (bodyError) return bodyError;

    try {
        const p = await prisma.invProduct.findUnique({ where: { id }, select });
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        const current = productGalleryUrls(p.galleryJson, p.imageUrl);

        let next: string[];
        if ("add" in op) {
            if (!op.add.every(isOwnPhotoUrl)) {
                return NextResponse.json({ error: "Only photos uploaded from the app can be added" }, { status: 400 });
            }
            next = [...current, ...op.add.filter((u) => !current.includes(u))];
            if (next.length > MAX_PRODUCT_PHOTOS) {
                return NextResponse.json(
                    { error: `A product can hold ${MAX_PRODUCT_PHOTOS} photos from the phone. Remove one first.` },
                    { status: 422 },
                );
            }
        } else if ("remove" in op) {
            next = current.filter((u) => u !== op.remove);
        } else if ("aiSkip" in op) {
            if (!current.includes(op.aiSkip)) {
                return NextResponse.json({ error: "That photo is no longer on this product. Refresh." }, { status: 409 });
            }
            next = current.map((u) => (u === op.aiSkip ? setAiSkipped(u, op.skip) : u));
        } else {
            if (!current.includes(op.makeMain)) {
                return NextResponse.json({ error: "That photo is no longer on this product. Refresh." }, { status: 409 });
            }
            next = [op.makeMain, ...current.filter((u) => u !== op.makeMain)];
        }

        const saved = await updateShopProduct(id, { galleryUrls: next, imageUrl: next[0] ?? null });
        if (saved.response) return saved.response;
        const body: ProductPhotos = {
            id: p.id,
            name: p.name,
            sku: p.sku,
            galleryUrls: saved.product.galleryUrls,
            isListedInShop: saved.product.isListedInShop,
            wasListedInShop: p.isListedInShop,
        };
        return NextResponse.json(body);
    } catch (e) {
        return handleApiError(e, "Could not save the photo");
    }
}
