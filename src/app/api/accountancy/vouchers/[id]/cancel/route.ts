import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { cancelVoucherInTx } from "@/modules/accountancy/lib/cancelVoucherInTx";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const schema = z.object({ reason: z.string().trim().min(1, "Cancel reason required") });

// POST /api/accountancy/vouchers/[id]/cancel
// Marks the spine CANCELLED, which drops it from every summed balance. Phase 5 5E: the spine IS the financial voucher; `id` is the spine id.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prismaWhereSaved().universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { type: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind cancel gate (falls back to generic finance:voucher:cancel).
    if (!userCanVoucher(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        // Balance reversal + CANCELLED stamp live in the shared helper (the POS
        // shift reopen/delete routes void their vouchers through the same path).
        await prisma.$transaction(async (tx) => {
            await cancelVoucherInTx(tx, Number(id), user!.id, data.reason);
        }, { timeout: 30_000, maxWait: 10_000 });

        const cancelled = await prismaWhereSaved().universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel voucher");
    }
}
