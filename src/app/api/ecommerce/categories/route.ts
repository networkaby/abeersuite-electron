import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    try {
        const grouped = await invProductDb(prisma).groupBy({
            by: ["shopCategory"],
            where: { isListedInShop: true, isActive: true },
            _count: { id: true },
            orderBy: { shopCategory: "asc" },
        });
        const categories = grouped.map((g) => ({
            name: g.shopCategory ?? "Uncategorized",
            productCount: g._count.id,
        }));
        return NextResponse.json(categories);
    } catch (e) {
        return handleApiError(e, "Failed to list categories");
    }
}
