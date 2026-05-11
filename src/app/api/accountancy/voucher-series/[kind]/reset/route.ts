import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/accountancy/voucher-series/[kind]/reset
// Resets nextSeq to 0. Used at year-end to restart numbering from startFrom.
export async function POST(
    _: Request,
    { params }: { params: Promise<{ kind: string }> },
) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { kind } = await params;

    try {
        const series = await prisma.voucherSeries.update({
            where: { kind },
            data: { nextSeq: 0 },
        });
        return NextResponse.json(series);
    } catch {
        return NextResponse.json({ error: "Voucher series not found" }, { status: 404 });
    }
}
