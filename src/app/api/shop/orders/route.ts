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
import { quoteShipping } from "@/modules/delivery/lib/shippingQuote";
import { resolvePayOnDelivery } from "@/shared/lib/payments/payOnDeliveryMethod";
import { loadDeliveryMethod, type ShiprocketConfig } from "@/modules/delivery/lib/deliveryMethods";
import { chargeableUnitGrams } from "@/modules/delivery/lib/chargeableWeight";

const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

const lineSchema = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(99),
});

const addressSchema = z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(20),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    locality: z.string().trim().max(120).optional().nullable(),
    neighbourhood: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    pincode: z.string().trim().regex(/^\d{6}$/u, "Enter a valid 6-digit pincode"),
});

const createOrderSchema = z.object({
    lines: z.array(lineSchema).min(1),
    accountId: z.coerce.number().int().positive(),
    shippingAddress: addressSchema,
    // The exact courier option the customer picked (e.g. "custom:2:0",
    // "shiprocket:3:51"). Re-priced server-side against the fresh quote.
    optionId: z.string().trim().min(1).max(80),
    paymentMethod: z.enum(["COD", "ONLINE"]).optional(),
    // The online gateway the customer chose at checkout (e.g. "razorpay", "payu",
    // "cashfree", "demo") — snapshotted so the order page opens the right flow.
    onlineProvider: z.string().trim().max(40).optional(),
});

export async function POST(req: Request) {
    try {
        const customerAuth = await requirePortalCustomer();
        if (customerAuth.response) return customerAuth.response;
        const { customerId } = customerAuth;

        const { data, error } = await validateRequest(req, createOrderSchema);
        if (error) return error;
        const { lines, accountId, shippingAddress, optionId, paymentMethod, onlineProvider } = data;

        const context = await resolvePortalAccountContext(customerId, accountId);
        if (context.active.accountId !== accountId) {
            return NextResponse.json({ error: "Account is not linked to this profile" }, { status: 403 });
        }

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const [products, bands, ordersPipeline, stockPolicy, srMethod] = await Promise.all([
            invProductDb(prisma).findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
            getOrdersPipeline(prisma),
            loadShopStockPolicy(),
            loadDeliveryMethod("SHIPROCKET"),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));
        const fallbackWeight =
            Number((srMethod?.configJson as ShiprocketConfig | undefined)?.defaultItemWeightGrams) ||
            DEFAULT_ITEM_WEIGHT_GRAMS;

        let totalPaise = 0;
        let weightGrams = 0;
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
            weightGrams += chargeableUnitGrams(p, fallbackWeight) * l.quantity;
            resolvedLines.push({
                productId: l.productId,
                quantity: l.quantity,
                unitPricePaise,
            });
        }

        // Re-price shipping server-side for the chosen courier — never trust a
        // client-sent amount. COD unless the customer chose the online (demo) rail.
        const isCod = (paymentMethod ?? "COD") === "COD";

        // Guard the Pay-on-Delivery rail server-side: reject a COD order when the
        // rail is switched off or the destination is outside its area rule.
        if (isCod) {
            const pod = await resolvePayOnDelivery(shippingAddress.pincode, shippingAddress.state);
            if (!pod.availableHere) {
                return NextResponse.json(
                    { error: "Pay on delivery isn't available for this address." },
                    { status: 400 },
                );
            }
        }
        const options = await quoteShipping({
            deliveryPincode: shippingAddress.pincode,
            deliveryState: shippingAddress.state,
            deliveryNeighbourhood: shippingAddress.neighbourhood ?? undefined,
            subtotalPaise: totalPaise,
            weightGrams,
            cod: isCod,
        });
        const chosen = options.find((o) => o.optionId === optionId);
        if (!chosen) {
            return NextResponse.json(
                { error: "The selected delivery option is not available for this address." },
                { status: 400 }
            );
        }
        const shippingChargePaise = chosen.amountPaise;

        // Place the order on the sales-orders pipeline (P7) at its entry stage —
        // it becomes a ticket on the staff orders board.
        const entryStatus = ordersPipeline?.statuses.find((s) => s.isEntryPoint);

        // An order is a Ticket (flavour "order") + TicketOrder detail on the orders
        // pipeline (P7). Core status = the pipeline entry stage; legacy enum on detail.
        const t = await prisma.ticket.create({
            data: {
                accountId: context.active.accountId,
                pipelineId: ordersPipeline?.id ?? null,
                status: entryStatus?.id ?? "S1",
                order: {
                    create: {
                        legacyStatus: "PENDING_PAYMENT",
                        paymentMethod: isCod ? "COD" : "ONLINE",
                        totalPaise,
                        shippingChargePaise,
                        courier: chosen.kind,
                        personId: customerId,
                        guestEmail: null,
                        guestPhone: shippingAddress.phone,
                        shippingName: shippingAddress.name,
                        shippingAddress: {
                            name: shippingAddress.name,
                            phone: shippingAddress.phone,
                            line1: shippingAddress.line1,
                            line2: shippingAddress.line2 ?? null,
                            locality: shippingAddress.locality ?? null,
                            neighbourhood: shippingAddress.neighbourhood ?? null,
                            city: shippingAddress.city,
                            state: shippingAddress.state,
                            pincode: shippingAddress.pincode,
                            // Snapshot of the courier the customer picked (for the delivery step).
                            courierKind: chosen.kind,
                            courierOptionId: chosen.optionId,
                            courierService: chosen.serviceName ?? chosen.label,
                            // Store pickup only — the store's note (address / timings) so the
                            // order page can tell the customer where to collect.
                            pickupNote: chosen.pickupNote ?? null,
                            shiprocketCourierId: chosen.shiprocketCourierId ?? null,
                            shiprocketCourierName: chosen.shiprocketCourierName ?? null,
                            // Snapshot of the online gateway chosen at checkout (null for COD).
                            onlineProvider: isCod ? null : onlineProvider ?? null,
                        },
                        lines: {
                            create: resolvedLines.map((r) => ({
                                productId: r.productId,
                                quantity: r.quantity,
                                unitPricePaise: r.unitPricePaise,
                            })),
                        },
                    },
                },
            },
            select: {
                id: true,
                status: true,
                order: { select: { totalPaise: true, shippingChargePaise: true, legacyStatus: true } },
            },
        });
        const goods = t.order?.totalPaise ?? 0;
        const shipping = t.order?.shippingChargePaise ?? 0;
        const order = {
            id: t.id,
            totalPaise: goods,
            shippingChargePaise: shipping,
            grandTotalPaise: goods + shipping,
            paymentMethod: isCod ? "COD" : "ONLINE",
            status: t.order?.legacyStatus,
        };

        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `New shop order #${order.id}`,
            body: `Total ₹ ${(order.grandTotalPaise / 100).toFixed(2)} · ${context.active.label}`,
            link: `/office/ecommerce/orders/${order.id}`,
        });

        return NextResponse.json(order);
    } catch (e) {
        return handleApiError(e, "Failed to create order");
    }
}
