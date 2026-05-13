// GET /api/pos/shifts/current
//
// Returns the current user's OPEN shift in the active branch, or null when
// they don't have one. PosScreen calls this on mount: if null → show
// ShiftOpenDialog; if a shift exists → show ActiveShiftBar.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { handleApiError } from "@/shared/lib/api";

export async function GET(req: NextRequest) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const session = await auth();
        let branchId: string;
        try { branchId = resolveActiveBranchId(req, session); }
        catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
            throw e;
        }

        const shift = await prisma.posShift.findFirst({
            where:  { userId: user!.id, branchId, status: "OPEN" },
            include: {
                tillAccount: { select: { id: true, name: true, balance: true } },
                branch:      { select: { id: true, name: true, vaultAccountId: true } },
                drops:       { orderBy: { droppedAt: "desc" }, select: { id: true, amountPaise: true, droppedAt: true, notes: true } },
            },
            orderBy: { openedAt: "desc" },
        });

        if (!shift) return NextResponse.json(null);

        // BigInt is not JSON-serializable — stringify selectively.
        return NextResponse.json({
            ...shift,
            openingFloatPaise: shift.openingFloatPaise.toString(),
            declaredCashPaise: shift.declaredCashPaise?.toString() ?? null,
            expectedCashPaise: shift.expectedCashPaise?.toString() ?? null,
            variancePaise:     shift.variancePaise?.toString() ?? null,
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch current shift");
    }
}
