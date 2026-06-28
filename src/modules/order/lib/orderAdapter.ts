import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { syncVoucherLink } from "@/modules/accountancy/lib/voucherLinks";

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
    // G3 — credit at the Review gate: the customer's limit + current AR, and whether
    // confirming this order on credit would breach it (deny-by-default: NULL/0 limit =
    // no credit). null for shop orders / accounts we can't resolve.
    credit: { limit: number; outstanding: number; breach: boolean } | null;
}

/** All orders across channels, optionally filtered to one P7 stage. */
export async function listOrders(opts?: { statusId?: string }): Promise<NormalizedOrder[]> {
    const statusWhere = opts?.statusId ? opts.statusId : { not: null };

    const [invs, shops] = await Promise.all([
        prisma.invVoucher.findMany({
            where: {
                type: { in: ["POS_ORDER", "SALES_ORDER"] },
                orderStatusId: statusWhere,
                universalVoucher: { deletedAt: null },   // 5D-8: lifecycle on spine
            },
            select: {
                id: true, type: true, partyJson: true,
                universalVoucher: { select: { partyAccountId: true, voucherNo: true } },   // 5D-4 party + 5D-6 ref
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

    // Batch-load the customers' credit state (one query) so each inv order can show
    // whether confirming it on credit would breach the limit — the Review gate.
    const acctIds = [...new Set(invs.map((v) => v.universalVoucher?.partyAccountId).filter((x): x is number => x != null))];
    const acctRows = acctIds.length
        ? await prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, creditLimit: true, balance: true } })
        : [];
    const acctById = new Map(acctRows.map((a) => [a.id, a]));

    const fromInv: NormalizedOrder[] = invs.map((v) => {
        const total = toNumber(v.totalAmount);
        const partyAccountId = v.universalVoucher?.partyAccountId ?? null;
        const acct = partyAccountId != null ? acctById.get(partyAccountId) : undefined;
        let credit: NormalizedOrder["credit"] = null;
        if (acct) {
            // Deny-by-default: NULL limit == 0 == no credit (mirrors checkCreditLimit).
            const limit = acct.creditLimit == null ? 0 : toNumber(acct.creditLimit);
            const outstanding = toNumber(acct.balance); // positive = customer owes us
            const breach = limit === 0 ? total > 0.005 : outstanding + total > limit + 0.005;
            credit = { limit, outstanding: Math.max(0, outstanding), breach };
        }
        return {
            source: "inv",
            id: v.id,
            ref: v.universalVoucher?.voucherNo ?? "",
            kind: v.type as "POS_ORDER" | "SALES_ORDER",
            customerName: readPartyName(v.partyJson),
            total,
            statusId: v.orderStatusId,
            branchId: v.branchId,
            dealId: v.dealId,
            createdAt: v.createdAt.toISOString(),
            credit,
        };
    });
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
        credit: null,
    }));

    return [...fromInv, ...fromShop].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Resolve an OrderRef to its backing object's current pipeline state. */
export async function resolveOrderStatus(ref: OrderRef): Promise<{ statusId: string | null } | null> {
    if (ref.source === "inv") {
        const v = await prisma.invVoucher.findUnique({ where: { id: ref.id }, select: { orderStatusId: true, universalVoucher: { select: { deletedAt: true } } } });   // 5D-8
        if (!v || v.universalVoucher?.deletedAt) return null;
        return { statusId: v.orderStatusId };
    }
    const o = await prisma.shopOrder.findUnique({ where: { id: ref.id }, select: { statusId: true } });
    return o ? { statusId: o.statusId } : null;
}

/** Write a new P7 stage onto the backing object (the only differing line per source). */
export async function writeOrderStatus(ref: OrderRef, statusId: string): Promise<void> {
    if (ref.source === "inv") {
        // Phase 5 5A: keep the spine's ORDER_STATUS VoucherLink in step with the
        // column (dual-write) — atomically so the board reader can't see a half-move.
        await prisma.$transaction(async (tx) => {
            const v = await tx.invVoucher.update({
                where:  { id: ref.id },
                data:   { orderStatusId: statusId },
                select: { universalVoucherId: true },
            });
            await syncVoucherLink(tx, v.universalVoucherId, "ORDER_STATUS", statusId);
        });
    } else {
        await prisma.shopOrder.update({ where: { id: ref.id }, data: { statusId } });
    }
}
