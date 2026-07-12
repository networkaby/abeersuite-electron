import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { assertOrderStatus, ORDER_STAGE, ORDER_RELEASE_STAGES } from "@/modules/order/lib/orderPipeline";
import { resolveOrderStatus, writeOrderStatus, type OrderSource } from "@/modules/order/lib/orderAdapter";
import { reserveOrder, releaseOrder } from "@/modules/order/lib/reservation";
import { releaseRedemptions } from "@/modules/order/lib/redemptionHold";
import { spawnDelivery } from "@/modules/delivery/lib/delivery";
import { spawnRefund } from "@/modules/refund/lib/refund";

// PATCH /api/orders/[source]/[id]/status   body { statusId }
//
// Move an order (any channel) along the P7 Orders pipeline. The order is
// polymorphic — `source` = "inv" (POS_ORDER/SALES_ORDER voucher) | "shop"
// (ShopOrder) — but the move logic is shared via the order adapter. The target
// stage must belong to P7 and (if the order already has a stage) be a SEEDED
// StatusTransition from the current one.
export async function PATCH(req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
    // Gate on accountancy:view for now (the same gate POS/order creation uses);
    // a dedicated orders:manage permission can replace this later.
    const { response } = await requireModuleAccess("orders");
    if (response) return response;

    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if ((source !== "inv" && source !== "shop") || !Number.isInteger(id) || id < 1) {
        return NextResponse.json({ error: "Invalid order ref" }, { status: 400 });
    }

    try {
        const { statusId } = (await req.json()) as { statusId?: string };
        if (!statusId) return NextResponse.json({ error: "statusId required" }, { status: 400 });

        const ref = { source: source as OrderSource, id };
        const current = await resolveOrderStatus(ref);
        if (!current) return NextResponse.json({ error: "Order not found" }, { status: 404 });

        const check = await assertOrderStatus(prisma, statusId);
        if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

        // Enforce the seeded transition graph for an actual move.
        if (current.statusId && current.statusId !== statusId) {
            const allowed = await prisma.statusTransition.findFirst({
                where: { fromStatusId: current.statusId, toStatusId: statusId },
                select: { id: true },
            });
            if (!allowed) {
                return NextResponse.json({ error: "That stage move isn't allowed for orders.", code: "TRANSITION_NOT_ALLOWED" }, { status: 400 });
            }
        }

        await writeOrderStatus(ref, statusId);

        // O2C reservation hooks: hold stock when the order is Confirmed; release it
        // when the order is Cancelled/Returned. (Fulfil — convert hold → stock-out —
        // is Phase 3.) Best-effort: a reservation hiccup must not undo the move.
        try {
            if (statusId === ORDER_STAGE.CONFIRMED) {
                await reserveOrder(ref);
                await spawnDelivery(ref);   // P8 delivery sub-pipeline
            } else if (ORDER_RELEASE_STAGES.includes(statusId)) {
                await releaseOrder(ref);
                await releaseRedemptions(ref);   // free any held loyalty/coupon/gift-card value
                await spawnRefund(ref);          // P9: refund the advance if one was collected
            }
        } catch (e) {
            console.error("[orders] confirm hooks failed for", ref, e);
        }

        return NextResponse.json({ source, id, statusId });
    } catch (e) {
        return handleApiError(e, "Failed to move order");
    }
}
