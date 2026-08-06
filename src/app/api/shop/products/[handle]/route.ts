import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { handleApiError } from "@/shared/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
    try {
        const { handle } = await ctx.params;
        const decoded = decodeURIComponent(handle);
        const asId = /^\d+$/.test(decoded) ? parseInt(decoded, 10) : null;

        const db = invProductDb(prisma);
        const product = asId
            ? await db.findFirst({
                  where: { id: asId, isListedInShop: true, isActive: true },
                  include: { category: { select: { name: true } } },
              })
            : await db.findFirst({
                  where: { slug: decoded, isListedInShop: true, isActive: true },
                  include: { category: { select: { name: true } } },
              });

        if (!product) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const [bands, rules, policy, groupIndex] = await Promise.all([
            loadBarcodeBands(),
            loadShopPublishRules(),
            loadShopStockPolicy(),
            loadShopGroupIndex(),
        ]);
        const avail = resolveAvailability(product.stock, product.allowBackorder, policy);
        // HIDE policy: out-of-stock product is removed from the shop.
        if (!avail.visible) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const pub = invProductToPublic(product, { bands, avail, groupIndex });
        // Defensive: a listed-but-incomplete product 404s rather than rendering broken.
        if (!shopQualification(pub, rules).qualified) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json(pub);
    } catch (e) {
        return handleApiError(e, "Failed to load product");
    }
}
