import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { invProductToPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    try {
        const bands = await loadBarcodeBands();
        const products = await invProductDb(prisma).findMany({
            where: { isListedInShop: true, isActive: true },
            include: { category: { select: { name: true } } },
            orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
        });
        const published = products
            .map((p) => invProductToPublic(p, bands))
            // Defensive: never show a half-built product even if the flag is stale.
            .filter((p) => shopQualification(p).qualified);
        return NextResponse.json(published);
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
