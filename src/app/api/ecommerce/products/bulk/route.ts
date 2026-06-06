import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { resolveShopListing } from "@/modules/ecommerce/lib/shopListing";

// Bulk publish / unpublish for the ecommerce Products list.
// - unpublish: clears isListedInShop for every id (no gate).
// - publish: only lists ids that meet the org's publish rules; the rest are
//   reported as `skipped`. Auto-fills a slug when a newly-listed product lacks
//   one (mirrors the single-product publish path).

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["publish", "unpublish"]),
});

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const { ids, action } = data;

    try {
        if (action === "unpublish") {
            const res = await prisma.invProduct.updateMany({
                where: { id: { in: ids } },
                data: { isListedInShop: false },
            });
            return NextResponse.json({ published: 0, skipped: 0, unpublished: res.count });
        }

        // publish — gate each product by the current rules
        const [bands, rules] = await Promise.all([loadBarcodeBands(), loadShopPublishRules()]);
        const products = await prisma.invProduct.findMany({
            where: { id: { in: ids } },
            select: {
                id: true, name: true, sku: true, imageUrl: true, galleryJson: true,
                shopDescription: true, shopCategory: true, stock: true, savedSalePricePaise: true,
                mrpPaise: true, effectiveSalePricePaise: true, slug: true,
            },
        });

        const readyWithSlug: number[] = [];
        const readyNeedSlug: { id: number; slug: string | null }[] = [];
        let skipped = 0;

        for (const p of products) {
            const gallery = Array.isArray(p.galleryJson)
                ? (p.galleryJson as unknown[]).filter((x): x is string => typeof x === "string")
                : [];
            const listing = resolveShopListing(
                {
                    name: p.name, sku: p.sku, imageUrl: p.imageUrl, galleryUrls: gallery,
                    shopDescription: p.shopDescription, shopCategory: p.shopCategory,
                    stock: p.stock,
                    savedSalePricePaise: p.savedSalePricePaise, mrpPaise: p.mrpPaise,
                    effectiveSalePricePaise: p.effectiveSalePricePaise, slug: p.slug,
                },
                { explicitListed: true, bands, rules }
            );
            if (!listing.ok) { skipped++; continue; }
            if (p.slug) readyWithSlug.push(p.id);
            else readyNeedSlug.push({ id: p.id, slug: listing.slug });
        }

        let published = 0;
        if (readyWithSlug.length) {
            const r = await prisma.invProduct.updateMany({
                where: { id: { in: readyWithSlug } },
                data: { isListedInShop: true },
            });
            published += r.count;
        }
        // Slug-less rows need per-row updates (unique slug). Tolerate the rare
        // slug collision by skipping that one product.
        for (const it of readyNeedSlug) {
            try {
                await prisma.invProduct.update({
                    where: { id: it.id },
                    data: { isListedInShop: true, ...(it.slug ? { slug: it.slug } : {}) },
                });
                published++;
            } catch {
                skipped++;
            }
        }

        return NextResponse.json({ published, skipped, unpublished: 0 });
    } catch (e) {
        return handleApiError(e, "Bulk update failed");
    }
}
