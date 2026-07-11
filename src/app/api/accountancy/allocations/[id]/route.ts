import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// DELETE /api/accountancy/allocations/[id]
// Unlink an allocation. The underlying vouchers remain — only the link is removed.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    try {
        await prisma.voucherAllocation.delete({ where: { id: Number(id) } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to remove allocation");
    }
}
