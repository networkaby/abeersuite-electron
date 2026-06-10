import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getDeliveryPipeline } from "@/modules/delivery/lib/delivery";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// GET /api/deliveries → { stages, deliveries } for the Delivery board (P8).
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;
    try {
        const [pipeline, deliveries] = await Promise.all([
            getDeliveryPipeline(),
            prisma.delivery.findMany({
                select: { id: true, orderSource: true, orderId: true, statusId: true, carrier: true, awb: true, trackingUrl: true, chargeToCustomerPaise: true, createdAt: true },
                orderBy: { createdAt: "desc" },
            }),
        ]);

        // Resolve the order reference/customer for each delivery (inv vouchers in one batch).
        const invIds = deliveries.filter((d) => d.orderSource === "inv").map((d) => d.orderId);
        const invs = invIds.length
            ? await prisma.invVoucher.findMany({ where: { id: { in: invIds } }, select: { id: true, reference: true, partyJson: true } })
            : [];
        const refMap = new Map(invs.map((v) => [v.id, { ref: v.reference, customer: readPartyName(v.partyJson) }]));

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
