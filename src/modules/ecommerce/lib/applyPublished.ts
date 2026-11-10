import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { shopSlugClash } from "@/shared/lib/shop/shopSlug";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { resolveShopListing } from "@/modules/ecommerce/lib/shopListing";
import { variantAttrGaps } from "@/modules/ecommerce/lib/shopQualification";

/**
 * Make these products PUBLISHED and decide, against today's publish rules, which
 * are live and which wait as Pending. A live product with no slug gets one; a
 * rare slug clash leaves that one Pending.
 *
 * Shared by bulk Publish and the re-check (publish-rules save, "Re-check
 * pending") — a Pending product is otherwise only re-judged on its own save, so
 * loosening a rule never put the waiting ones live.
 */
/**
 * Sibling attributes still empty on each of these products (variant rule). Two
 * reads whatever the count: the products' families, then every member of them.
 */
export async function loadVariantAttrGaps(ids: number[]): Promise<Map<number, string[]>> {
    if (ids.length === 0) return new Map();
    const fams = await prisma.invProduct.findMany({
        where: { id: { in: ids }, variantFamilyId: { not: null } },
        select: { variantFamilyId: true },
        distinct: ["variantFamilyId"],
    });
    const familyIds = fams.map((f) => f.variantFamilyId!).filter((v) => v != null);
    if (familyIds.length === 0) return new Map();
    const members = await prisma.invProduct.findMany({
        where: { variantFamilyId: { in: familyIds } },
        select: { id: true, variantFamilyId: true, attrsJson: true },
    });
    return variantAttrGaps(members.map((m) => ({ ...m, attrs: m.attrsJson as Record<string, unknown> | null })));
}

/**
 * Re-judge the Published members of these products' variant families — one
 * member's attributes (or the family itself) changing can put a sibling into or
 * out of Pending. Call after an attribute save or a family add / remove.
 */
export async function recheckVariantFamilies(productIds: number[]): Promise<void> {
    if (productIds.length === 0) return;
    const fams = await prisma.invProduct.findMany({
        where: { id: { in: productIds }, variantFamilyId: { not: null } },
        select: { variantFamilyId: true },
        distinct: ["variantFamilyId"],
    });
    const familyIds = fams.map((f) => f.variantFamilyId!).filter((v) => v != null);
    const members = await prisma.invProduct.findMany({
        where: {
            shopStatus: "PUBLISHED",
            OR: [{ id: { in: productIds } }, ...(familyIds.length ? [{ variantFamilyId: { in: familyIds } }] : [])],
        },
        select: { id: true },
    });
    await applyPublished(members.map((m) => m.id));
}

export async function applyPublished(ids: number[]): Promise<{ published: number; pending: number }> {
    if (ids.length === 0) return { published: 0, pending: 0 };
    const [bands, rules, gaps] = await Promise.all([loadBarcodeBands(), loadShopPublishRules(), loadVariantAttrGaps(ids)]);
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
                savedSalePricePaise: p.savedSalePricePaise, barcodeManualPaise: p.barcodeManualPaise, mrpPaise: p.mrpPaise,
                effectiveSalePricePaise: p.effectiveSalePricePaise, slug: p.slug,
                variantAttrGaps: gaps.get(p.id),
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
    return { published, pending: pending.length };
}

/**
 * Re-judge every Published product (live + Pending) against today's rules.
 * Returns how many changed side, so the caller can say "12 went live · 3 moved to Pending".
 */
export async function recheckPublished(): Promise<{ wentLive: number; wentPending: number; live: number; pending: number }> {
    const before = await prisma.invProduct.findMany({
        where: { shopStatus: "PUBLISHED" },
        select: { id: true, isListedInShop: true },
    });
    const wasLive = new Set(before.filter((p) => p.isListedInShop).map((p) => p.id));
    const { published, pending } = await applyPublished(before.map((p) => p.id));
    const nowLive = await prisma.invProduct.findMany({
        where: { id: { in: before.map((p) => p.id) }, isListedInShop: true },
        select: { id: true },
    });
    const nowLiveSet = new Set(nowLive.map((p) => p.id));
    const wentLive = nowLive.filter((p) => !wasLive.has(p.id)).length;
    const wentPending = [...wasLive].filter((id) => !nowLiveSet.has(id)).length;
    return { wentLive, wentPending, live: published, pending };
}
