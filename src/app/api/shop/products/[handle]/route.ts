import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { invProductDb } from "@/shared/types/inventoryTypes";

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
        return NextResponse.json(invProductToPublic(product));
    } catch {
        return NextResponse.json({ error: "Failed to load product" }, { status: 500 });
    }
}
