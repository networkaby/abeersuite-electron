import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ShopOrderStatus } from "@/generated/prisma/enums";
import { balanceDelta, nextRef, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { canTransition, ORDER_STATUS_TRANSITIONS } from "@/modules/ecommerce/lib/orderStatusTransitions";
import { CONFIRMED_STATUS_LABEL } from "@/modules/ecommerce/lib/ordersPipeline";
import { selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

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
        tx.account.findFirst({ where: { code: "4150" } }),
    ]);
    if (!bank || !revenue) {
        throw new Error('Required GL accounts missing — seed chart (codes "1010", "4150").');
    }
    const amount = totalPaise / 100;
    if (amount <= 0) return null;

    const reference = await nextRefFromSeries(tx, "GL_POSTING", createdById);
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
            description: `Shop order #${orderId} — shop sales revenue`,
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

/**
 * Auto-create a DRAFT GL Invoice when an order is Confirmed.
 * Links Invoice.shopOrderId → order.id and sets the account from order.accountId.
 */
async function createOrderInvoice(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    order: {
        id: number;
        accountId: number | null;
        totalPaise: number;
        lines: { product: { name: string }; quantity: number; unitPricePaise: number }[];
    },
    createdById: number,
): Promise<number | null> {
    if (!order.accountId) return null;

    const number = await nextRef(tx, "invoice", "INV");
    const computedLines = order.lines.map((l) => {
        const subtotal = l.quantity * (l.unitPricePaise / 100);
        return {
            description: l.product.name,
            quantity: l.quantity,
            unitPrice: l.unitPricePaise / 100,
            taxRate: 0,
            taxAmount: 0,
            amount: subtotal,
        };
    });
    const subtotal = computedLines.reduce((s, l) => s + l.amount, 0);
    const totalAmount = subtotal;

    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await tx.invoice.create({
        data: {
            number,
            status: "DRAFT",
            issueDate: today,
            dueDate,
            accountId: order.accountId,
            shopOrderId: order.id,
            subtotal,
            taxAmount: 0,
            totalAmount,
            amountPaid: 0,
            createdById,
            lines: { create: computedLines },
        },
    });

    return invoice.id;
}

/** Run after DB commit — inbox only. */
export async function notifyStaffLowStock(productName: string, productId: number, stock: number) {
    await createSystemInboxNotifications({
        roleIds: ["R1", "R2"],
        title: "Low stock alert",
        body: `${productName} (#${productId}) is at ${stock} units.`,
        link: `/office/ecommerce/products/${productId}`,
    });
}

export type TransitionShopOrderInput = {
    orderId: number;
    to: ShopOrderStatus;
    courier?: string | null;
    trackingNumber?: string | null;
    actorUserId: number;
};

export type TransitionOrderPipelineInput = {
    orderId: number;
    toStatusId: string;
    toStatusLabel: string;
    courier?: string | null;
    trackingNumber?: string | null;
    actorUserId: number;
};

/** Pipeline-based status transition for sales orders (P7). */
export async function transitionOrderPipelineStatus(input: TransitionOrderPipelineInput) {
    const { orderId, toStatusId, toStatusLabel, courier, trackingNumber, actorUserId } = input;

    const result = await prisma.$transaction(async (tx) => {
        const order = await tx.shopOrder.findUnique({
            where: { id: orderId },
            include: {
                lines: { include: { product: true } },
                account: true,
                invoice: { select: { id: true } },
            },
        });
        if (!order) throw new Error("Order not found");

        const lowStockHints: { name: string; id: number; stock: number }[] = [];

        // Decrement stock on Confirmed (sale is committed at this point)
        if (toStatusLabel === CONFIRMED_STATUS_LABEL) {
            for (const line of order.lines) {
                const p = line.product;
                if (p.stock === null) continue;
                if (p.stock < line.quantity) {
                    throw new Error(`Insufficient stock for ${p.name} (need ${line.quantity}, have ${p.stock})`);
                }
                const nextStock = p.stock - line.quantity;
                await tx.invProduct.update({
                    where: { id: p.id },
                    data: { stock: nextStock },
                });
                if (nextStock <= p.lowStockThreshold) {
                    lowStockHints.push({ name: p.name, id: p.id, stock: nextStock });
                }
            }
        }

        const updated = await tx.shopOrder.update({
            where: { id: orderId },
            data: {
                statusId: toStatusId,
                ...(courier !== undefined ? { courier: courier ?? null } : {}),
                ...(trackingNumber !== undefined ? { trackingNumber: trackingNumber ?? null } : {}),
            },
            include: {
                lines: { include: { product: true } },
                account: true,
            },
        });

        // Auto-create DRAFT invoice when order is Confirmed
        let invoiceId: number | null = null;
        if (toStatusLabel === CONFIRMED_STATUS_LABEL && !order.invoice) {
            invoiceId = await createOrderInvoice(tx, order, actorUserId);
        }

        return { order: updated, lowStockHints, invoiceId };
    });

    const link = `/office/ecommerce/orders/${orderId}`;
    if (toStatusLabel === CONFIRMED_STATUS_LABEL) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} confirmed`,
            body: result.invoiceId
                ? `Invoice auto-created (INV). Ready for packing.`
                : `Order confirmed. Ready for packing.`,
            link,
        });
    }
    if (input.trackingNumber && toStatusLabel === "Dispatched") {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} dispatched`,
            body: input.trackingNumber
                ? `Courier: ${input.courier ?? "—"} · Tracking: ${input.trackingNumber}`
                : "Update tracking on the order detail page.",
            link,
        });
    }

    for (const hint of result.lowStockHints) {
        await notifyStaffLowStock(hint.name, hint.id, hint.stock);
    }

    return result;
}

export async function transitionShopOrderStatus(input: TransitionShopOrderInput) {
    const { orderId, to, courier, trackingNumber, actorUserId } = input;

    const result = await prisma.$transaction(async (tx) => {
        const order = await tx.shopOrder.findUnique({
            where: { id: orderId },
            include: {
                lines: { include: { product: true } },
                person: {
                    select: {
                        id: true,
                        name: true,
                        emails: selectPrimaryEmail,
                    },
                },
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
                await tx.invProduct.update({
                    where: { id: p.id },
                    data: { stock: nextStock },
                });
                if (nextStock <= p.lowStockThreshold) {
                    lowStockHints.push({ name: p.name, id: p.id, stock: nextStock });
                }
            }
        }

        // Stock: restore on REFUNDED if was PAID+
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
                    await tx.invProduct.update({
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
                person: {
                    select: {
                        id: true,
                        name: true,
                        emails: selectPrimaryEmail,
                    },
                },
            },
        });

        let journalId: number | null = null;
        if (to === ShopOrderStatus.PAID && order.status !== ShopOrderStatus.PAID && !order.paidAt) {
            const je = await postSaleJournal(tx, order.id, order.totalPaise, actorUserId);
            journalId = je?.id ?? null;
        }

        return { order: updated, prevStatus: order.status, lowStockHints, journalId };
    });

    const link = `/office/ecommerce/orders/${orderId}`;
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
