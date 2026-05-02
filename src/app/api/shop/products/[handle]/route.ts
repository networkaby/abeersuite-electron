import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { shopProductToPublic } from "@/lib/shop/product-public";

export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
    try {
        const { handle } = await ctx.params;
        const decoded = decodeURIComponent(handle);
        const asId = /^\d+$/.test(decoded) ? parseInt(decoded, 10) : null;

        const product = asId
            ? await prisma.shopProduct.findFirst({
                  where: { id: asId, isActive: true },
              })
            : await prisma.shopProduct.findFirst({
                  where: { slug: decoded, isActive: true },
              });

        if (!product) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json(shopProductToPublic(product));
    } catch {
        return NextResponse.json({ error: "Failed to load product" }, { status: 500 });
    }
}
