import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
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
        const bands = await loadBarcodeBands();
        const pub = invProductToPublic(product, bands);
        // Defensive: a listed-but-incomplete product 404s rather than rendering broken.
        if (!shopQualification(pub).qualified) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json(pub);
    } catch (e) {
        return handleApiError(e, "Failed to load product");
    }
}
