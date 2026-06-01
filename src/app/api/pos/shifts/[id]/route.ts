// GET /api/pos/shifts/[id]
//
// Full shift detail — header info, drops list, linked Contras, and the
// running cash-sales total computed from CASH-method Payment rows tied
// to this counter in the shift window. Used by ActiveShiftBar polling,
// ShiftCloseDialog, and the audit page.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sumPaise, sumShiftCashSalesPaise, buildShiftTenderBreakdown } from "@/modules/pos/lib/shiftMath";

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
                user:    { select: { id: true, name: true, email: true } },
                branch:  { select: { id: true, name: true, vaultAccountId: true } },
                counter: {
                    include: { tillAccount: { select: { id: true, name: true, balance: true } } },
                },
                openedBy:             { select: { id: true, name: true } },
                closedBy:             { select: { id: true, name: true } },
                openingContraVoucher: { select: { id: true, reference: true, date: true } },
                closingContraVoucher: { select: { id: true, reference: true, date: true } },
                varianceJournalEntry: { select: { id: true, reference: true, date: true } },
                handover: {
                    select: {
                        id: true, status: true,
                        declaredByAPaise: true, countedByBPaise: true, carryOverPaise: true,
                        toUser:  { select: { id: true, name: true } },
                        toShift: { select: { id: true } },
                    },
                },
                receivedHandover: {
                    select: {
                        id: true,
                        fromShift: { select: { id: true, userId: true, user: { select: { name: true } } } },
                        declaredByAPaise: true, countedByBPaise: true,
                    },
                },
                drops: {
                    orderBy: { droppedAt: "desc" },
                    include: { droppedBy: { select: { id: true, name: true } } },
                },
                expenditures: {
                    orderBy: { createdAt: "desc" },
                    select:  { id: true, amountPaise: true, description: true, voucherId: true, createdAt: true },
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

        // Running cash-sales total — sum of debits to the counter till from
        // receipt vouchers posted during the shift window. Replaces the
        // legacy CASH Payment query (Payment table retired 2026-05-24).
        const cashSalesPaise = await sumShiftCashSalesPaise(prisma, {
            tillAccountId: shift.counter.tillAccount.id,
            openedAt:      shift.openedAt,
            closedAt:      shift.closedAt,
        });
        const dropsPaise        = sumPaise(shift.drops);
        const expendituresPaise = sumPaise(shift.expenditures);

        // Per-method tally of everything collected this shift (cash + digital).
        const tenderBreakdown = await buildShiftTenderBreakdown(prisma, {
            counter:  shift.counter,
            openedAt: shift.openedAt,
            closedAt: shift.closedAt,
        });

        return NextResponse.json({
            ...shift,
            tenderBreakdown,
            openingFloatPaise:   shift.openingFloatPaise.toString(),
            carryOverFloatPaise: shift.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     shift.vaultTopUpPaise.toString(),
            declaredCashPaise:   shift.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   shift.expectedCashPaise?.toString()  ?? null,
            variancePaise:       shift.variancePaise?.toString()      ?? null,
            carryOverNextPaise:  shift.carryOverNextPaise?.toString() ?? null,
            toVaultPaise:        shift.toVaultPaise?.toString()       ?? null,
            cashSalesPaise:      cashSalesPaise.toString(),
            dropsPaise:          dropsPaise.toString(),
            expendituresPaise:   expendituresPaise.toString(),
            runningExpectedPaise: (shift.openingFloatPaise + cashSalesPaise - dropsPaise - expendituresPaise).toString(),
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
            expenditures: shift.expenditures.map((e) => ({ ...e, amountPaise: e.amountPaise.toString() })),
            handover: shift.handover ? {
                ...shift.handover,
                declaredByAPaise: shift.handover.declaredByAPaise.toString(),
                countedByBPaise:  shift.handover.countedByBPaise?.toString() ?? null,
                carryOverPaise:   shift.handover.carryOverPaise.toString(),
            } : null,
            receivedHandover: shift.receivedHandover ? {
                ...shift.receivedHandover,
                declaredByAPaise: shift.receivedHandover.declaredByAPaise.toString(),
                countedByBPaise:  shift.receivedHandover.countedByBPaise?.toString() ?? null,
            } : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch shift");
    }
}
