import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";

// GET /api/finance/vouchers/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy:    { select: { id: true, name: true } },
            cancelledBy:  { select: { id: true, name: true } },
            deletedBy:    { select: { id: true, name: true } },
            partyAccount: { select: { id: true, code: true, name: true } },
            lines: {
                include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
            },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(voucher);
}
