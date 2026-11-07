import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { productPath } from "@/shared/lib/shop/productPublic";
import { loadUnitCostMap } from "@/modules/inventory/lib/costBasis";

/**
 * Price Watch (owner, 2026-11-08: "an independent skill so we can run it
 * frequently and know what price needs attention, a report in the cloud
 * itself"). Read only — our price, MRP and stock for the products asked;
 * Claude compares them with Amazon.in / Flipkart / the maker and writes the
 * report itself. Nothing is saved; prices change only in Pricing Strategy.
 * Its own key ("Claude — Price watch"). The skill: .claude/skills/price-watch.
 */

const csv = z.string().trim().transform((v) => v.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.string()).max(50));
const flag = z.enum(["1", "true", "yes", "0", "false", "no"]).transform((v) => ["1", "true", "yes"].includes(v));

export const pricesQuery = z.object({
    sku: csv.optional(),
    /** Words in the name, SKU or a barcode. */
    q: z.string().trim().min(2).max(100).optional(),
    brand: z.string().trim().min(1).max(100).optional(),
    group: z.string().trim().min(1).max(100).optional(),
    /** Default: published only (what customers see). "all" = any stage. */
    stage: z.enum(["published", "ready", "unpublished", "all"]).optional(),
    /** Default: in stock only. inStock=0 includes out-of-stock. */
    inStock: flag.optional(),
    /** Our last purchase cost too — only when the owner asks for it in the run. */
    withCost: flag.default(false),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    before: z.coerce.number().int().positive().optional(),
});

export async function productPrices(q: z.infer<typeof pricesQuery>, origin: string) {
    const named = !!(q.sku?.length || q.q);
    const stage = q.stage ?? (named ? "all" : "published");
    const inStock = q.inStock ?? !named;
    const limit = q.sku?.length ? Math.max(q.limit, q.sku.length) : q.limit;
    const where: Prisma.InvProductWhereInput = {
        isActive: true,
        ...(q.sku?.length && { sku: { in: q.sku } }),
        ...(q.q && {
            AND: q.q.split(/\s+/).map((w) => ({
                OR: [
                    { name: { contains: w, mode: "insensitive" as const } },
                    { sku: { contains: w, mode: "insensitive" as const } },
                    { codes: { some: { value: { contains: w, mode: "insensitive" as const } } } },
                ],
            })),
        }),
        ...(stage !== "all" && { shopStatus: stage.toUpperCase() as ShopStatus }),
        ...(inStock && { stock: { gt: 0 } }),
        ...(q.brand && { brand: { name: { contains: q.brand, mode: "insensitive" } } }),
        ...(q.group && { group: { name: { contains: q.group, mode: "insensitive" } } }),
        ...(q.before && { id: { lt: q.before } }),
    };
    const [rows, bands] = await Promise.all([
        prisma.invProduct.findMany({
            where,
            orderBy: { id: "desc" },
            take: limit,
            select: {
                id: true, sku: true, name: true, shopSubheading: true, modelNo: true, slug: true, stock: true, shopStatus: true, isListedInShop: true,
                savedSalePricePaise: true, barcodeManualPaise: true, mrpPaise: true, effectiveSalePricePaise: true,
                brand: { select: { name: true } }, group: { select: { name: true } },
                codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
            },
        }),
        loadBarcodeBands(),
    ]);
    const costs = q.withCost && rows.length ? await loadUnitCostMap(rows.map((r) => r.id), new Date(), "LAST_INWARD") : null;
    const rupees = (paise: number | null | undefined) => (paise == null ? null : paise / 100);
    if (q.sku?.length) rows.sort((a, b) => q.sku!.indexOf(a.sku.toUpperCase()) - q.sku!.indexOf(b.sku.toUpperCase()));
    const notFound = q.sku?.filter((s) => !rows.some((r) => r.sku.toUpperCase() === s)) ?? [];

    return {
        checkedAt: new Date().toISOString(),
        products: rows.map((r) => {
            const shopPaise = barcodeTagPaise(r.savedSalePricePaise, r.mrpPaise, bands, r.barcodeManualPaise) ?? r.effectiveSalePricePaise;
            const cost = costs?.get(r.id);
            return {
                id: r.id,
                sku: r.sku,
                name: r.shopSubheading?.trim() || r.name,
                brand: r.brand?.name ?? null,
                group: r.group?.name ?? null,
                modelNo: r.modelNo,
                /** The maker's EAN / UPC — the surest way to find the same product elsewhere. */
                barcodes: r.codes.map((c) => c.value),
                /** What a customer pays here (₹, GST included) — the barcode tag. */
                ourPrice: rupees(shopPaise),
                mrp: rupees(r.mrpPaise),
                stock: r.stock,
                shopStatus: r.shopStatus,
                live: r.isListedInShop,
                shopUrl: r.isListedInShop ? `${origin}${productPath({ id: r.id, slug: r.slug })}` : null,
                /** Last purchase rate as on the purchase bill (₹ per unit) — asked for with withCost=1 only. */
                ...(costs && { lastCost: cost && !cost.fallback && cost.unitCost > 0 ? Math.round(cost.unitCost * 100) / 100 : null }),
            };
        }),
        ...(notFound.length && { notFound }),
        nextBefore: !q.sku?.length && rows.length === limit ? rows[rows.length - 1].id : null,
    };
}
