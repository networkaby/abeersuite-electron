import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    try {
        const products = await invProductDb(prisma).findMany({
            where: { isListedInShop: true, isActive: true },
            include: { category: { select: { name: true } } },
            orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
        });
        return NextResponse.json(products.map(invProductToPublic));
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
