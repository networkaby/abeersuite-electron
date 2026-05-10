import { prisma } from "@/shared/lib/prisma/prismaClient";
import SalesDashboard from "@/modules/ecommerce/components/SalesDashboard";

export default async function EcommerceDashboardPage() {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [paid7, paid30, pendingPaymentCount, fulfilmentQueueCount, productsTracked] = await Promise.all([
        prisma.shopOrder.findMany({
            where: {
                paidAt: { gte: d7 },
                status: { notIn: ["REFUNDED", "CANCELLED"] },
            },
            select: { totalPaise: true },
        }),
        prisma.shopOrder.findMany({
            where: {
                paidAt: { gte: d30 },
                status: { notIn: ["REFUNDED", "CANCELLED"] },
            },
            select: { totalPaise: true },
        }),
        prisma.shopOrder.count({ where: { status: "PENDING_PAYMENT" } }),
        prisma.shopOrder.count({
            where: { status: { in: ["PAID", "PACKED", "SHIPPED"] } },
        }),
        prisma.invProduct.findMany({
            where: { isActive: true, stock: { not: null } },
            select: { id: true, name: true, stock: true, lowStockThreshold: true },
        }),
    ]);

    const revenue7dPaise = paid7.reduce((s, o) => s + o.totalPaise, 0);
    const revenue30dPaise = paid30.reduce((s, o) => s + o.totalPaise, 0);
    const lowStock = productsTracked
        .filter((p) => p.stock !== null && p.stock <= p.lowStockThreshold)
        .map((p) => ({ id: p.id, name: p.name, stock: p.stock! }));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">E-commerce</h1>
                <p className="text-muted-foreground text-sm">Sales overview and operational signals.</p>
            </div>
            <SalesDashboard
                revenue7dPaise={revenue7dPaise}
                revenue30dPaise={revenue30dPaise}
                pendingPaymentCount={pendingPaymentCount}
                fulfilmentQueueCount={fulfilmentQueueCount}
                lowStock={lowStock}
            />
        </div>
    );
}
