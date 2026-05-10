import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductDb } from "@/shared/types/inventoryTypes";

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
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
    } catch {
        return NextResponse.json({ error: "Failed to list categories" }, { status: 500 });
    }
}
