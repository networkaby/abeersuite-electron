import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const orders = await prisma.shopOrder.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
            include: {
                customer: { select: { id: true, name: true, email: true, phone: true } },
                lines: { include: { product: { select: { name: true } } } },
            },
        });
        return NextResponse.json(orders);
    } catch {
        return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
    }
}
