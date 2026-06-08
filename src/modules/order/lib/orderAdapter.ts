import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

// The unified Order is polymorphic (lightweight model — no new table): an "order"
// is either an order-type InvVoucher (POS_ORDER / SALES_ORDER) or a ShopOrder,
// both riding pipeline P7. This adapter normalises them so the board / status-move
// / fulfil / delivery all operate on one shape keyed by an OrderRef {source,id}.

export type OrderSource = "inv" | "shop";
export interface OrderRef { source: OrderSource; id: number }

export interface NormalizedOrder {
    source: OrderSource;
    id: number;
    ref: string;                 // display reference (POSOD-… / SO-… / WEB-<id>)
    kind: "POS_ORDER" | "SALES_ORDER" | "SHOP";
    customerName: string | null;
    total: number;               // rupees
    statusId: string | null;     // current P7 stage
    branchId: string | null;
    dealId: number | null;
    createdAt: string;           // ISO
}

/** All orders across channels, optionally filtered to one P7 stage. */
export async function listOrders(opts?: { statusId?: string }): Promise<NormalizedOrder[]> {
    const statusWhere = opts?.statusId ? opts.statusId : { not: null };

    const [invs, shops] = await Promise.all([
        prisma.invVoucher.findMany({
            where: {
                type: { in: ["POS_ORDER", "SALES_ORDER"] },
                orderStatusId: statusWhere,
                deletedAt: null,
            },
            select: {
                id: true, reference: true, type: true, partyName: true,
                totalAmount: true, orderStatusId: true, branchId: true, dealId: true, createdAt: true,
            },
            orderBy: { createdAt: "desc" },
        }),
        prisma.shopOrder.findMany({
            where: { statusId: statusWhere },
            select: { id: true, statusId: true, totalPaise: true, shippingName: true, guestEmail: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    const fromInv: NormalizedOrder[] = invs.map((v) => ({
        source: "inv",
        id: v.id,
        ref: v.reference,
        kind: v.type as "POS_ORDER" | "SALES_ORDER",
        customerName: v.partyName ?? null,
        total: toNumber(v.totalAmount),
        statusId: v.orderStatusId,
        branchId: v.branchId,
        dealId: v.dealId,
        createdAt: v.createdAt.toISOString(),
    }));
    const fromShop: NormalizedOrder[] = shops.map((o) => ({
        source: "shop",
        id: o.id,
        ref: `WEB-${o.id}`,
        kind: "SHOP",
        customerName: o.shippingName ?? o.guestEmail ?? null,
        total: o.totalPaise / 100,
        statusId: o.statusId,
        branchId: null,
        dealId: null,
        createdAt: o.createdAt.toISOString(),
    }));

    return [...fromInv, ...fromShop].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Resolve an OrderRef to its backing object's current pipeline state. */
export async function resolveOrderStatus(ref: OrderRef): Promise<{ statusId: string | null } | null> {
    if (ref.source === "inv") {
        const v = await prisma.invVoucher.findUnique({ where: { id: ref.id }, select: { orderStatusId: true, deletedAt: true } });
        if (!v || v.deletedAt) return null;
        return { statusId: v.orderStatusId };
    }
    const o = await prisma.shopOrder.findUnique({ where: { id: ref.id }, select: { statusId: true } });
    return o ? { statusId: o.statusId } : null;
}

/** Write a new P7 stage onto the backing object (the only differing line per source). */
export async function writeOrderStatus(ref: OrderRef, statusId: string): Promise<void> {
    if (ref.source === "inv") {
        await prisma.invVoucher.update({ where: { id: ref.id }, data: { orderStatusId: statusId } });
    } else {
        await prisma.shopOrder.update({ where: { id: ref.id }, data: { statusId } });
    }
}
