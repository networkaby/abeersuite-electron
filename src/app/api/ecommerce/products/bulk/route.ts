import { prisma } from "@/shared/lib/prisma/prismaClient";
import { shopSlugClash } from "@/shared/lib/shop/shopSlug";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { resolveShopListing } from "@/modules/ecommerce/lib/shopListing";

// Bulk Mark ready / Publish / Unpublish for the E-Commerce Products list (owner, 2026-11-07).
// - ready: Unpublished → READY (complete, waiting for a good time; not live).
// - publish: every id becomes PUBLISHED. Those meeting the publish rules go live;
//   the rest are Pending and go live by themselves once fixed. A live product
//   with no slug gets one (same as the single-product save).
// - unpublish: Published / Pending → READY, off the shop (the work is finished).
// A product in Draft is skipped and named — finish it (Save as ready) or Discard draft first.

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["publish", "unpublish", "ready"]),
});

export async function POST(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    let { ids } = data;
    const { action } = data;

    try {
        const inDraft = await prisma.invProduct.findMany({
            where: { id: { in: ids }, shopStatus: "DRAFT" },
            select: { id: true, name: true },
        });
        const skipped = { inDraft: inDraft.length, names: inDraft.slice(0, 5).map((p) => p.name) };
        const draftIds = new Set(inDraft.map((p) => p.id));
        ids = ids.filter((id) => !draftIds.has(id));

        if (action === "ready") {
            const res = await prisma.invProduct.updateMany({
                where: { id: { in: ids }, shopStatus: "UNPUBLISHED" },
                data: { shopStatus: "READY", isListedInShop: false },
            });
            return NextResponse.json({ published: 0, pending: 0, unpublished: 0, ready: res.count, skipped });
        }
        if (action === "unpublish") {
            const res = await prisma.invProduct.updateMany({
                where: { id: { in: ids }, shopStatus: "PUBLISHED" },
                data: { shopStatus: "READY", isListedInShop: false },
            });
            return NextResponse.json({ published: 0, pending: 0, unpublished: res.count, skipped });
        }

        const [bands, rules] = await Promise.all([loadBarcodeBands(), loadShopPublishRules()]);
        const products = await prisma.invProduct.findMany({
            where: { id: { in: ids } },
            select: {
                id: true, name: true, sku: true, imageUrl: true, galleryJson: true,
                shopDescription: true, shopCategory: true, stock: true, savedSalePricePaise: true, barcodeManualPaise: true,
                mrpPaise: true, effectiveSalePricePaise: true, slug: true,
                groupId: true, brandId: true, allowBackorder: true, weightGrams: true,
            },
        });

        const liveWithSlug: number[] = [];
        const liveNeedSlug: { id: number; slug: string | null }[] = [];
        const pending: number[] = [];

        for (const p of products) {
            const gallery = Array.isArray(p.galleryJson)
                ? (p.galleryJson as unknown[]).filter((x): x is string => typeof x === "string")
                : [];
            const listing = resolveShopListing(
                {
                    name: p.name, sku: p.sku, imageUrl: p.imageUrl, galleryUrls: gallery,
                    shopDescription: p.shopDescription, shopCategory: p.shopCategory,
                    groupId: p.groupId, brandId: p.brandId,
                    stock: p.stock, allowBackorder: p.allowBackorder,
                    weightGrams: p.weightGrams,
                    savedSalePricePaise: p.savedSalePricePaise, mrpPaise: p.mrpPaise,
                    effectiveSalePricePaise: p.effectiveSalePricePaise, slug: p.slug,
                },
                { status: "PUBLISHED", bands, rules }
            );
            if (!listing.isListedInShop) pending.push(p.id);
            else if (p.slug) liveWithSlug.push(p.id);
            else liveNeedSlug.push({ id: p.id, slug: listing.slug });
        }

        if (pending.length) {
            await prisma.invProduct.updateMany({
                where: { id: { in: pending } },
                data: { shopStatus: "PUBLISHED", isListedInShop: false },
            });
        }
        let published = 0;
        if (liveWithSlug.length) {
            const r = await prisma.invProduct.updateMany({
                where: { id: { in: liveWithSlug } },
                data: { shopStatus: "PUBLISHED", isListedInShop: true },
            });
            published += r.count;
        }
        // Slug-less rows need per-row updates (unique slug). A rare slug clash
        // leaves that one Pending — published, waiting for a slug.
        for (const it of liveNeedSlug) {
            const clash = it.slug ? await shopSlugClash(it.slug, { kind: "product", id: it.id }) : null;
            await prisma.invProduct.update({
                where: { id: it.id },
                data: clash || !it.slug
                    ? { shopStatus: "PUBLISHED", isListedInShop: false }
                    : { shopStatus: "PUBLISHED", isListedInShop: true, slug: it.slug },
            });
            if (clash || !it.slug) pending.push(it.id);
            else published++;
        }

        return NextResponse.json({ published, pending: pending.length, unpublished: 0, skipped });
    } catch (e) {
        return handleApiError(e, "Bulk update failed");
    }
}
