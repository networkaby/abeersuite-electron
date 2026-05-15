import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { validateRequest, handleApiError } from "@/shared/lib/api";

const lineSchema = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(99),
});

const createOrderSchema = z.object({
    lines: z.array(lineSchema).min(1),
    accountId: z.coerce.number().int().positive(),
});

export async function POST(req: Request) {
    try {
        const customerAuth = await requirePortalCustomer();
        if (customerAuth.response) return customerAuth.response;
        const { customerId } = customerAuth;

        const { data, error } = await validateRequest(req, createOrderSchema);
        if (error) return error;
        const { lines, accountId } = data;

        const context = await resolvePortalAccountContext(customerId, accountId);
        if (context.active.accountId !== accountId) {
            return NextResponse.json({ error: "Account is not linked to this profile" }, { status: 403 });
        }

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const products = await invProductDb(prisma).findMany({
            where: { id: { in: productIds }, isListedInShop: true, isActive: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        let totalPaise = 0;
        const resolvedLines: { productId: number; quantity: number; unitPricePaise: number }[] = [];
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (!p || p.pricePaise == null) {
                return NextResponse.json({ error: `Unknown product ${l.productId}` }, { status: 400 });
            }
            if (p.stock !== null && p.stock < l.quantity) {
                return NextResponse.json(
                    { error: `Not enough stock for “${p.name}”. Available: ${p.stock}.` },
                    { status: 400 }
                );
            }
            totalPaise += p.pricePaise * l.quantity;
            resolvedLines.push({
                productId: l.productId,
                quantity: l.quantity,
                unitPricePaise: p.pricePaise,
            });
        }

        const order = await prisma.shopOrder.create({
            data: {
                status: "PENDING_PAYMENT",
                totalPaise,
                personId: customerId,
                accountId: context.active.accountId,
                guestEmail: null,
                guestPhone: null,
                lines: {
                    create: resolvedLines.map((r) => ({
                        productId: r.productId,
                        quantity: r.quantity,
                        unitPricePaise: r.unitPricePaise,
                    })),
                },
            },
            select: { id: true, totalPaise: true, status: true },
        });

        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `New shop order #${order.id}`,
            body: `Total ₹ ${(order.totalPaise / 100).toFixed(2)} · ${context.active.label}`,
            link: `/office/ecommerce/orders/${order.id}`,
        });

        return NextResponse.json(order);
    } catch (e) {
        return handleApiError(e, "Failed to create order");
    }
}
