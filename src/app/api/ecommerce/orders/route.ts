import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { ShopOrderStatus } from "@/generated/prisma/enums";

export async function GET(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusParam = searchParams.get("status");
        const q = searchParams.get("q")?.trim();
        const from = searchParams.get("from");
        const to = searchParams.get("to");

        const statusFilter =
            statusParam && Object.values(ShopOrderStatus).includes(statusParam as ShopOrderStatus)
                ? (statusParam as ShopOrderStatus)
                : undefined;

        const orders = await prisma.shopOrder.findMany({
            where: {
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(from || to
                    ? {
                          createdAt: {
                              ...(from ? { gte: new Date(from) } : {}),
                              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
                          },
                      }
                    : {}),
                ...(q
                    ? {
                          OR: [
                              { customer: { name: { contains: q, mode: "insensitive" as const } } },
                              { customer: { email: { contains: q, mode: "insensitive" as const } } },
                              { customer: { phone: { contains: q } } },
                              { account: { company: { name: { contains: q, mode: "insensitive" as const } } } },
                              ...(Number.isFinite(Number(q)) && String(Number(q)) === q.trim()
                                  ? [{ id: Number(q) }]
                                  : []),
                          ],
                      }
                    : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 500,
            include: {
                customer: { select: { id: true, name: true, email: true, phone: true } },
                account: {
                    select: {
                        id: true,
                        company: { select: { id: true, name: true } },
                    },
                },
                lines: { include: { product: { select: { id: true, name: true, imageUrl: true } } } },
            },
        });

        return NextResponse.json(orders);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
    }
}
