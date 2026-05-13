// GET /api/pos/shifts/[id]
//
// Full shift detail — header info, drops list, linked Contras, and the
// running cash-sales total computed from CASH-method Payment rows in the
// shift window. Used by the shift detail drawer / page.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sumPaise } from "@/modules/pos/lib/shiftMath";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_VIEW_BR);
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const shift = await prisma.posShift.findUnique({
            where: { id },
            include: {
                user:                 { select: { id: true, name: true, email: true } },
                branch:               { select: { id: true, name: true, vaultAccountId: true } },
                tillAccount:          { select: { id: true, name: true, balance: true } },
                openedBy:             { select: { id: true, name: true } },
                closedBy:             { select: { id: true, name: true } },
                openingContraVoucher: { select: { id: true, reference: true, date: true } },
                closingContraVoucher: { select: { id: true, reference: true, date: true } },
                varianceJournalEntry: { select: { id: true, reference: true, date: true } },
                drops: {
                    orderBy: { droppedAt: "desc" },
                    include: { droppedBy: { select: { id: true, name: true } } },
                },
            },
        });
        if (!shift) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Branch-scoped users can only see their own branches' shifts unless org/admin.
        const isOrg =
            user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
            user!.permissions.includes(PERMISSIONS.POS_SHIFT_VIEW_ORG);
        if (!isOrg && !user!.branchIds.includes(shift.branchId)) {
            return NextResponse.json({ error: "No access to this branch's shifts" }, { status: 403 });
        }

        // Running cash-sales total — sum of CASH-method Payment rows for this
        // user in the shift window. Excludes cancelled/deleted payments.
        const cashEnd = shift.closedAt ?? new Date();
        const cashPayments = await prisma.payment.findMany({
            where: {
                method:      "CASH",
                status:      "POSTED",
                deletedAt:   null,
                createdById: shift.userId,
                createdAt:   { gte: shift.openedAt, lte: cashEnd },
            },
            select: { amount: true },
        });
        const cashSalesPaise = cashPayments.reduce((s, p) => s + BigInt(Math.round(Number(p.amount) * 100)), BigInt(0));
        const dropsPaise = sumPaise(shift.drops);

        return NextResponse.json({
            ...shift,
            openingFloatPaise: shift.openingFloatPaise.toString(),
            declaredCashPaise: shift.declaredCashPaise?.toString() ?? null,
            expectedCashPaise: shift.expectedCashPaise?.toString() ?? null,
            variancePaise:     shift.variancePaise?.toString() ?? null,
            cashSalesPaise:    cashSalesPaise.toString(),
            dropsPaise:        dropsPaise.toString(),
            // Running expected balance (matches what shift-close will compute).
            runningExpectedPaise: (shift.openingFloatPaise + cashSalesPaise - dropsPaise).toString(),
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch shift");
    }
}
