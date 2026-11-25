import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucherKind } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { removeLink } from "@/modules/accountancy/lib/billLink";

// DELETE /api/accountancy/allocations/[id]
// Unlink. Both vouchers stay exactly as they were — only the statement about
// which bill the money belonged to goes, and both ends go back to open.
//
// Gated at the same rung as making the link: `cancel` on both kinds. Without
// this, anyone who could merely view the books could un-settle a bill.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    try {
        const link = await prismaWhereSaved().voucherAllocation.findUnique({
            where:  { id: Number(id) },
            select: { id: true, targetId: true, sourceId: true },
        });
        if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const vouchers = await prismaWhereSaved().universalVoucher.findMany({
            where:  { id: { in: [link.targetId, link.sourceId] } },
            select: { type: true },
        });
        // A link whose vouchers are already gone is debris — let it be removed.
        // Kind-less variant, or a POS bill's link could never be undone.
        if (!vouchers.every((v) => userCanVoucherKind(user, v.type, "cancel"))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const removed = await prisma.$transaction((tx) => removeLink(tx, Number(id)));
        return NextResponse.json({ ok: true, removed });
    } catch (e) {
        return handleApiError(e, "Failed to remove allocation");
    }
}
