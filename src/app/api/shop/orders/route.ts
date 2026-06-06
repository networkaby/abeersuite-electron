import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { getOrdersPipeline } from "@/modules/ecommerce/lib/ordersPipeline";

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
        const [products, bands, ordersPipeline, stockPolicy] = await Promise.all([
            invProductDb(prisma).findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
            getOrdersPipeline(prisma),
            loadShopStockPolicy(),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));

        let totalPaise = 0;
        const resolvedLines: { productId: number; quantity: number; unitPricePaise: number }[] = [];
        for (const l of lines) {
            const p = byId.get(l.productId);
            // Charge the barcode tag (what the storefront shows), falling back to
            // the effective price when there's no saved sale price.
            const unitPricePaise = p
                ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) ?? p.effectiveSalePricePaise
                : null;
            if (!p || unitPricePaise == null) {
                return NextResponse.json({ error: `Unknown product ${l.productId}` }, { status: 400 });
            }
            // Short stock is allowed only when the product (or the org policy)
            // permits backorder; otherwise block the order.
            const backorderable = p.allowBackorder || stockPolicy === "BACKORDER";
            if (p.stock !== null && p.stock < l.quantity && !backorderable) {
                return NextResponse.json(
                    {
                        error:
                            p.stock <= 0
                                ? `“${p.name}” is out of stock.`
                                : `Not enough stock for “${p.name}”. Available: ${p.stock}.`,
                    },
                    { status: 400 }
                );
            }
            totalPaise += unitPricePaise * l.quantity;
            resolvedLines.push({
                productId: l.productId,
                quantity: l.quantity,
                unitPricePaise,
            });
        }

        // Place the order on the sales-orders pipeline (P7) at its entry stage —
        // it becomes a ticket on the staff orders board.
        const entryStatus = ordersPipeline?.statuses.find((s) => s.isEntryPoint);

        const order = await prisma.shopOrder.create({
            data: {
                status: "PENDING_PAYMENT",
                paymentMethod: "COD",
                totalPaise,
                personId: customerId,
                accountId: context.active.accountId,
                guestEmail: null,
                guestPhone: null,
                pipelineId: ordersPipeline?.id ?? null,
                statusId: entryStatus?.id ?? null,
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
