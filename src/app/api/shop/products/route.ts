import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/lib/shop/product-public";
import { invProductDb } from "@/lib/inventory/types";

export async function GET() {
    try {
        const products = await invProductDb(prisma).findMany({
            where: { isListedInShop: true, isActive: true },
            include: { category: { select: { name: true } } },
            orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
        });
        return NextResponse.json(products.map(invProductToPublic));
    } catch {
        return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
    }
}
