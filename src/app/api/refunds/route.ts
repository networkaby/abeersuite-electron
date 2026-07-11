import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getRefundPipeline } from "@/modules/refund/lib/refund";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// GET /api/refunds → { stages, refunds } for the Refund board (P9).
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW);
    if (response) return response;
    try {
        const [pipeline, refundTickets] = await Promise.all([
            getRefundPipeline(),
            prisma.ticket.findMany({
                where: { refund: { isNot: null } },
                select: { id: true, status: true, createdAt: true, refund: { select: { orderSource: true, orderId: true, amountPaise: true, reason: true } } },
                orderBy: { createdAt: "desc" },
            }),
        ]);
        // Flatten each refund Ticket to the old flat Refund shape.
        const refunds = refundTickets.map((t) => ({ id: t.id, statusId: t.status, createdAt: t.createdAt, ...t.refund! }));

        // Resolve the order reference/customer for each refund (inv vouchers in one batch).
        const invIds = refunds.filter((r) => r.orderSource === "inv").map((r) => r.orderId);
        const invs = invIds.length
            ? await prisma.voucherDetail.findMany({ where: { id: { in: invIds } }, select: { id: true, partyJson: true, universalVoucher: { select: { voucherNo: true } } } })
            : [];
        const refMap = new Map(invs.map((v) => [v.id, { ref: v.universalVoucher?.voucherNo ?? "", customer: readPartyName(v.partyJson) }]));

        const stages = (pipeline?.statuses ?? []).map((s) => ({
            id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint,
        }));
        const items = refunds.map((r) => {
            const inv = r.orderSource === "inv" ? refMap.get(r.orderId) : null;
            return {
                id: r.id,
                statusId: r.statusId,
                amount: r.amountPaise / 100,
                reason: r.reason,
                orderRef: inv?.ref ?? `WEB-${r.orderId}`,
                customer: inv?.customer ?? null,
                createdAt: r.createdAt.toISOString(),
            };
        });
        return NextResponse.json({ stages, refunds: items });
    } catch (e) {
        return handleApiError(e, "Failed to load refunds");
    }
}
