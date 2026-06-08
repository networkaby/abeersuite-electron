import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getOrderPipeline } from "@/modules/order/lib/orderPipeline";
import { listOrders } from "@/modules/order/lib/orderAdapter";

// GET /api/orders → { stages, orders } for the unified Orders board (P7).
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;
    try {
        const [pipeline, orders] = await Promise.all([getOrderPipeline(prisma), listOrders()]);
        const stages = (pipeline?.statuses ?? []).map((s) => ({
            id: s.id, label: s.label, color: s.color, order: s.order,
            isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint,
        }));
        return NextResponse.json({ stages, orders });
    } catch (e) {
        return handleApiError(e, "Failed to load orders");
    }
}
