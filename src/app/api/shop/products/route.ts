import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupRoots } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    try {
        const [bands, rules, policy, groupRoots] = await Promise.all([
            loadBarcodeBands(),
            loadShopPublishRules(),
            loadShopStockPolicy(),
            loadShopGroupRoots(),
        ]);
        const products = await invProductDb(prisma).findMany({
            where: { isListedInShop: true, isActive: true },
            include: { category: { select: { name: true } } },
            orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
        });
        const published = products
            .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy) }))
            // HIDE policy drops out-of-stock products from the storefront entirely.
            .filter(({ avail }) => avail.visible)
            .map(({ p, avail }) => invProductToPublic(p, { bands, avail, groupRoots }))
            // Defensive: never show a half-built product even if the flag is stale.
            .filter((p) => shopQualification(p, rules).qualified);
        return NextResponse.json(published);
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
