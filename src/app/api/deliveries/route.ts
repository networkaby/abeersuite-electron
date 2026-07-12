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
                select: { id: true, status: true, createdAt: true, delivery: { select: { orderSource: true, orderId: true, carrier: true, awb: true, trackingUrl: true, chargeToCustomerPaise: true } } },
                orderBy: { createdAt: "desc" },
            }),
        ]);
        // Flatten each delivery Ticket to the old flat Delivery shape.
        const deliveries = deliveryTickets.map((t) => ({ id: t.id, statusId: t.status, createdAt: t.createdAt, ...t.delivery! }));

        // Resolve the order reference/customer for each delivery (inv vouchers in one batch).
        const invIds = deliveries.filter((d) => d.orderSource === "inv").map((d) => d.orderId);
        const invs = invIds.length
            ? await prisma.voucherDetail.findMany({ where: { id: { in: invIds } }, select: { id: true, partyJson: true, universalVoucher: { select: { voucherNo: true } } } })
            : [];
        const refMap = new Map(invs.map((v) => [v.id, { ref: v.universalVoucher?.voucherNo ?? "", customer: readPartyName(v.partyJson) }]));

        const stages = (pipeline?.statuses ?? []).map((s) => ({
            id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint,
        }));
        const items = deliveries.map((d) => {
            const inv = d.orderSource === "inv" ? refMap.get(d.orderId) : null;
            return {
                id: d.id,
                statusId: d.statusId,
                carrier: d.carrier,
                awb: d.awb,
                trackingUrl: d.trackingUrl,
                orderRef: inv?.ref ?? `WEB-${d.orderId}`,
                customer: inv?.customer ?? null,
                createdAt: d.createdAt.toISOString(),
            };
        });
        return NextResponse.json({ stages, deliveries: items });
    } catch (e) {
        return handleApiError(e, "Failed to load deliveries");
    }
}
