import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { entriesSinceReconciled } from "@/modules/accountancy/lib/reconciliation";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";

// GET /api/accountancy/ledgers/reconciled
//
// The ledgers reconciled right up to their last entry — watermark set and no
// posted entry after it — as [{ id, through }]. Tiny on purpose: every report
// that shows the green tick beside a balance reads this one list.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const locked = await prisma.account.findMany({
            where: { reconciledThrough: { not: null } },
            select: { id: true, reconciledThrough: true },
        });
        const pending = await entriesSinceReconciled(locked);
        return NextResponse.json(
            locked
                .filter((a) => !pending.get(a.id))
                .map((a) => ({ id: a.id, through: toDateOnlyUtc(a.reconciledThrough!) })),
        );
    } catch (e) {
        return handleApiError(e, "Failed to fetch reconciled ledgers");
    }
}
