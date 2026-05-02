import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { shopProductToPublic } from "@/lib/shop/product-public";

export async function GET() {
    try {
        const products = await prisma.shopProduct.findMany({
            where: { isActive: true },
            orderBy: [{ category: "asc" }, { id: "asc" }],
        });
        return NextResponse.json(products.map(shopProductToPublic));
    } catch {
        return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
    }
}
