import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";

// DELETE /api/finance/allocations/[id]
// Unlink an allocation. The underlying vouchers remain — only the link is removed.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("finance:allocation:manage");
    if (response) return response;

    const { id } = await params;
    try {
        await prisma.voucherAllocation.delete({ where: { id: Number(id) } });
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to remove allocation" }, { status: 500 });
    }
}
