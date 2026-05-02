import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const order = await prisma.shopOrder.findUnique({
            where: { id: oid },
            include: {
                customer: true,
                account: { include: { company: true } },
                sourceCoupon: true,
                lines: { include: { product: true } },
                tickets: { select: { id: true, status: true, notes: true, createdAt: true } },
            },
        });
        if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(order);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
    }
}
