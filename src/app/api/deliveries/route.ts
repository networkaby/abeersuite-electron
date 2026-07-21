import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getDeliveryPipeline } from "@/modules/delivery/lib/delivery";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// GET /api/deliveries → { stages, deliveries } for the Delivery board (P8).
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const [pipeline, deliveryTickets] = await Promise.all([
            getDeliveryPipeline(),
            prisma.ticket.findMany({
                where: { delivery: { isNot: null } },
                select: { id: true, status: true, createdAt: true, delivery: { select: { orderSource: true, orderId: true, carrier: true, awb: true, trackingUrl: true, chargeToCustomerPaise: true, costToCarrierPaise: true } } },
                orderBy: { createdAt: "desc" },
            }),
        ]);
        // Flatten each delivery Ticket to the old flat Delivery shape.
        const deliveries = deliveryTickets.map((t) => ({ id: t.id, statusId: t.status, createdAt: t.createdAt, ...t.delivery! }));

        // Resolve the order reference/customer for each delivery (inv vouchers + shop
        // orders in two batches). Shop orders also carry the COD amount to collect.
        const invIds = deliveries.filter((d) => d.orderSource === "inv").map((d) => d.orderId);
        const shopIds = deliveries.filter((d) => d.orderSource === "shop").map((d) => d.orderId);
        const [invs, shops] = await Promise.all([
            invIds.length
                ? prisma.voucherDetail.findMany({ where: { id: { in: invIds } }, select: { id: true, partyJson: true, universalVoucher: { select: { voucherNo: true } } } })
                : Promise.resolve([]),
            shopIds.length
                ? prisma.ticketOrder.findMany({ where: { ticketId: { in: shopIds } }, select: { ticketId: true, shippingName: true, guestEmail: true, paymentMethod: true, legacyStatus: true, totalPaise: true, shippingChargePaise: true } })
                : Promise.resolve([]),
        ]);
        const refMap = new Map(invs.map((v) => [v.id, { ref: v.universalVoucher?.voucherNo ?? "", customer: readPartyName(v.partyJson) }]));
        const shopMap = new Map(shops.map((o) => [o.ticketId, o]));

        const stages = (pipeline?.statuses ?? []).map((s) => ({
            id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint,
        }));
        const items = deliveries.map((d) => {
            const inv = d.orderSource === "inv" ? refMap.get(d.orderId) : null;
            const shop = d.orderSource === "shop" ? shopMap.get(d.orderId) : null;
            // COD to collect on delivery = grand total of an unpaid COD shop order.
            const codToCollectPaise =
                shop && shop.paymentMethod === "COD" && shop.legacyStatus !== "PAID"
                    ? shop.totalPaise + shop.shippingChargePaise
                    : 0;
            return {
                id: d.id,
                statusId: d.statusId,
                carrier: d.carrier,
                awb: d.awb,
                trackingUrl: d.trackingUrl,
                chargeToCustomerPaise: d.chargeToCustomerPaise,
                costToCarrierPaise: d.costToCarrierPaise,
                orderRef: inv?.ref ?? `WEB-${d.orderId}`,
                customer: inv?.customer ?? shop?.shippingName ?? shop?.guestEmail ?? null,
                codToCollectPaise,
                createdAt: d.createdAt.toISOString(),
            };
        });
        return NextResponse.json({ stages, deliveries: items });
    } catch (e) {
        return handleApiError(e, "Failed to load deliveries");
    }
}
