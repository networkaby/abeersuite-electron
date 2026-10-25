import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { restoreVoucherInTx } from "@/modules/accountancy/lib/restoreVoucherInTx";
import { writeRestoreAudit } from "@/modules/accountancy/lib/restoreAudit";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const schema = z.object({ reason: z.string().trim().min(1, "Restore reason required") });

// POST /api/accountancy/vouchers/[id]/restore
// Un-cancel: puts the spine back to POSTED. Gated by the SAME per-kind key as cancel — whoever
// may cancel a voucher kind may restore it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { type: true, voucherNo: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!userCanVoucher(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            await restoreVoucherInTx(tx, Number(id));
        }, { timeout: 30_000, maxWait: 10_000 });

        await writeRestoreAudit({
            entityType: "GL_VOUCHER", subtype: voucher.type, originalId: Number(id),
            originalRef: voucher.voucherNo ?? String(id), reason: data.reason, actorId: user!.id,
        });

        const restored = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to restore voucher");
    }
}
