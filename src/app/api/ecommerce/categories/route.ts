import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const grouped = await prisma.shopProduct.groupBy({
            by: ["category"],
            where: { isActive: true },
            _count: { id: true },
            orderBy: { category: "asc" },
        });
        const categories = grouped.map((g) => ({
            name: g.category,
            productCount: g._count.id,
        }));
        return NextResponse.json(categories);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to list categories" }, { status: 500 });
    }
}
