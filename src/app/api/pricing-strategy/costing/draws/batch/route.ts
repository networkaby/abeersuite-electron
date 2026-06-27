import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { costPoolAllocateBatchSchema } from "@/shared/lib/schemas/costPoolSchemas";
import { getEntryRemainingPaise } from "@/modules/pricing-strategy/lib/costPool";

// POST /api/pricing-strategy/costing/draws/batch — allocate one pool entry's
// freight across the product lines of a purchase/GRN voucher in one shot.
// Creates one ALLOCATION CostPoolDraw per line; the SUM is capped against the
// entry's remaining. NEVER posts to the GL.
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, costPoolAllocateBatchSchema);
        if (error) return error;

        const remaining = await getEntryRemainingPaise(data.sourceGlLineId);
        if (remaining == null) {
            return NextResponse.json(
                { error: "Source entry is not a posted debit (or was cancelled)." },
                { status: 400 },
            );
        }
        const total = data.lines.reduce((s, l) => s + l.amountPaise, 0);
        if (total > remaining) {
            return NextResponse.json(
                { error: `Total ₹${(total / 100).toFixed(2)} exceeds the entry's remaining ₹${(remaining / 100).toFixed(2)}.` },
                { status: 400 },
            );
        }

        const date = data.date ? new Date(data.date) : new Date();
        await prisma.additionalCostAllocation.createMany({
            data: data.lines.map((l) => ({
                kind: "ALLOCATION" as const,
                sourceVoucherGlLineId: data.sourceGlLineId,
                sourceInvVoucherId: data.sourceInvVoucherId ?? null,
                amountPaise: l.amountPaise,
                productId: l.productId,
                perUnitPaise: l.perUnitPaise,
                quantity: l.quantity ?? null,
                note: data.note ?? null,
                date,
                createdById: user.id,
            })),
        });

        return NextResponse.json({ created: data.lines.length, remainingPaise: remaining - total });
    } catch (e) {
        return handleApiError(e, "Failed to allocate");
    }
}
