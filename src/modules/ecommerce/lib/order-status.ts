import { prisma } from "@/lib/prisma";
import { ShopOrderStatus } from "@/generated/prisma/enums";
import { balanceDelta, nextRef } from "@/modules/tally/lib/balance";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { canTransition, ORDER_STATUS_TRANSITIONS } from "@/modules/ecommerce/lib/order-status-transitions";

export { canTransition, ORDER_STATUS_TRANSITIONS };

async function postSaleJournal(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    orderId: number,
    totalPaise: number,
    createdById: number,
) {
    const [bank, revenue] = await Promise.all([
        tx.account.findFirst({ where: { code: "1010" } }),
        tx.account.findFirst({ where: { code: "4100" } }),
    ]);
    if (!bank || !revenue) {
        throw new Error('Required GL accounts missing — seed chart (codes "1010", "4100").');
    }
    const amount = totalPaise / 100;
    if (amount <= 0) return null;

    const reference = await nextRef(tx, "journalEntry", "JE");
    const lines = [
        {
            accountId: bank.id,
            type: "DEBIT" as const,
            amount,
            description: `Shop order #${orderId} — payment received`,
        },
        {
            accountId: revenue.id,
            type: "CREDIT" as const,
            amount,
            description: `Shop order #${orderId} — parts revenue`,
        },
    ];

    const je = await tx.journalEntry.create({
        data: {
            date: new Date(),
            reference,
            description: `E-commerce sale — order #${orderId}`,
            status: "POSTED",
            postedAt: new Date(),
            createdById,
            lines: { create: lines },
        },
    });

    for (const line of lines) {
        const acct = await tx.account.findUnique({ where: { id: line.accountId } });
        if (!acct?.normalBalance) continue;
        const delta = balanceDelta(acct.normalBalance, line.type, line.amount);
        await tx.account.update({
            where: { id: line.accountId },
            data: { balance: { increment: delta } },
        });
    }

    return je;
}

/** Run after DB commit — inbox only. */
export async function notifyStaffLowStock(productName: string, productId: number, stock: number) {
    await createSystemInboxNotifications({
        roleIds: ["R1", "R2"],
        title: "Low stock alert",
        body: `${productName} (#${productId}) is at ${stock} units.`,
        link: `/ecommerce/products/${productId}`,
    });
}

export type TransitionShopOrderInput = {
    orderId: number;
    to: ShopOrderStatus;
    courier?: string | null;
    trackingNumber?: string | null;
    actorUserId: number;
};

export async function transitionShopOrderStatus(input: TransitionShopOrderInput) {
    const { orderId, to, courier, trackingNumber, actorUserId } = input;

    const result = await prisma.$transaction(async (tx) => {
        const order = await tx.shopOrder.findUnique({
            where: { id: orderId },
            include: {
                lines: { include: { product: true } },
                customer: { select: { id: true, name: true, email: true } },
            },
        });
        if (!order) throw new Error("Order not found");

        if (!canTransition(order.status, to)) {
            throw new Error(`Cannot transition from ${order.status} to ${to}`);
        }

        const lowStockHints: { name: string; id: number; stock: number }[] = [];
        const now = new Date();

        // Stock: decrement when entering PAID (first time)
        if (to === ShopOrderStatus.PAID && order.status !== ShopOrderStatus.PAID) {
            for (const line of order.lines) {
                const p = line.product;
                if (p.stock === null) continue;
                if (p.stock < line.quantity) {
                    throw new Error(`Insufficient stock for ${p.name} (need ${line.quantity}, have ${p.stock})`);
                }
                const nextStock = p.stock - line.quantity;
                await tx.shopProduct.update({
                    where: { id: p.id },
                    data: { stock: nextStock },
                });
                if (nextStock <= p.lowStockThreshold) {
                    lowStockHints.push({ name: p.name, id: p.id, stock: nextStock });
                }
            }
        }

        // Stock: restore on REFUNDED if was PAID+ (had decremented)
        if (to === ShopOrderStatus.REFUNDED && order.status !== ShopOrderStatus.REFUNDED) {
            const hadPaid =
                order.status === ShopOrderStatus.PAID ||
                order.status === ShopOrderStatus.PACKED ||
                order.status === ShopOrderStatus.SHIPPED ||
                order.status === ShopOrderStatus.DELIVERED;
            if (hadPaid) {
                for (const line of order.lines) {
                    const p = line.product;
                    if (p.stock === null) continue;
                    await tx.shopProduct.update({
                        where: { id: p.id },
                        data: { stock: { increment: line.quantity } },
                    });
                }
            }
        }

        const data = {
            status: to,
            ...(courier !== undefined ? { courier: courier ?? null } : {}),
            ...(trackingNumber !== undefined ? { trackingNumber: trackingNumber ?? null } : {}),
            ...(to === ShopOrderStatus.PAID ? { paidAt: order.paidAt ?? now } : {}),
            ...(to === ShopOrderStatus.PACKED ? { packedAt: order.packedAt ?? now } : {}),
            ...(to === ShopOrderStatus.SHIPPED ? { shippedAt: order.shippedAt ?? now } : {}),
            ...(to === ShopOrderStatus.DELIVERED ? { deliveredAt: order.deliveredAt ?? now } : {}),
            ...(to === ShopOrderStatus.REFUNDED ? { refundedAt: order.refundedAt ?? now } : {}),
        };

        const updated = await tx.shopOrder.update({
            where: { id: orderId },
            data,
            include: {
                lines: { include: { product: true } },
                customer: { select: { id: true, name: true, email: true } },
            },
        });

        let journalId: number | null = null;
        if (to === ShopOrderStatus.PAID && order.status !== ShopOrderStatus.PAID && !order.paidAt) {
            const je = await postSaleJournal(tx, order.id, order.totalPaise, actorUserId);
            journalId = je?.id ?? null;
        }

        return {
            order: updated,
            prevStatus: order.status,
            lowStockHints,
            journalId,
        };
    });

    // Inbox side-effects (after successful commit)
    const link = `/ecommerce/orders/${orderId}`;
    if (result.prevStatus === ShopOrderStatus.PENDING_PAYMENT && input.to === ShopOrderStatus.PAID) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} marked paid`,
            body: `Total ${(result.order.totalPaise / 100).toFixed(2)} INR recorded.`,
            link,
        });
    }
    if (input.to === ShopOrderStatus.SHIPPED) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} shipped`,
            body: input.trackingNumber
                ? `Courier: ${input.courier ?? "—"} · Tracking: ${input.trackingNumber}`
                : "Update tracking on the order detail page.",
            link,
        });
    }
    if (input.to === ShopOrderStatus.REFUNDED) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} refunded`,
            body: "Inventory restored where stock is tracked.",
            link,
        });
    }

    for (const hint of result.lowStockHints) {
        await notifyStaffLowStock(hint.name, hint.id, hint.stock);
    }

    return result;
}
