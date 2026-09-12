// GET /api/pos/shifts/[id]
//
// Full shift detail — header info, drops list, linked Contras, and the
// running cash-sales total computed from CASH-method Payment rows tied
// to this counter in the shift window. Used by ActiveShiftBar polling,
// ShiftCloseDialog, and the audit page.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sumPaise, sumShiftCashSalesPaise, sumShiftCashRefundsPaise, buildShiftTenderBreakdown } from "@/modules/pos/lib/shiftMath";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Any signed-in staff may ASK; access is decided per-shift below. The shift's
    // own operator always reads their shift (they run it — open/close/drop need no
    // oversight grant); everyone else needs the branch/org view permission.
    const { user, response } = await requireAuth();
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
                    include: {
                        tillAccount: { select: { id: true, name: true, balance: true } },
                        paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } },
                    },
                },
                openedBy:             { select: { id: true, name: true } },
                closedBy:             { select: { id: true, name: true } },
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
                // Receipts taken on the shift (digital ones never touch the till, so
                // cash sales can read ₹0 while the shift still carries them). The
                // detail page uses this to know whether the shift can be deleted.
                _count: { select: { receipts: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Access model: the shift's own operator always reads their own shift (no
        // oversight grant needed — they must be able to view + close it). Everyone
        // else needs oversight: admin sees any branch; pos:shift:view sees only
        // their own branches' shifts (branch is the only radius).
        const isOwner = shift.userId === user!.id;
        const isAdminUser = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        const canViewBranch =
            hasModuleNavAccess(user!.permissions, "pos") &&
            user!.branchIds.includes(shift.branchId);
        if (!isOwner && !isAdminUser && !canViewBranch) {
            return NextResponse.json({ error: "No access to this shift" }, { status: 403 });
        }

        // Running cash-sales total — sum of debits to the counter till from
        // receipt vouchers posted during the shift window. Replaces the
        // legacy CASH Payment query (Payment table retired 2026-05-24).
        const cashSalesPaise = await sumShiftCashSalesPaise(prisma, {
            tillAccountId: shift.counter.tillAccount.id,
            openedAt:      shift.openedAt,
            closedAt:      shift.closedAt,
        });
        const refundsPaise = await sumShiftCashRefundsPaise(prisma, {
            tillAccountId: shift.counter.tillAccount.id,
            openedAt:      shift.openedAt,
            closedAt:      shift.closedAt,
        });
        const dropsPaise        = sumPaise(shift.drops);
        const expendituresPaise = sumPaise(shift.expenditures);

        // Phase 5 5E: the opening/closing contras ARE spines now (Voucher dropped).
        // Resolve them by id to keep the old response shape the UI consumes.
        const contraIds = [shift.openingContraVoucherId, shift.closingContraVoucherId].filter((x): x is number => x != null);
        const contras = contraIds.length === 0 ? [] : await prisma.universalVoucher.findMany({
            where: { id: { in: contraIds } }, select: { id: true, voucherNo: true, date: true },
        });
        const contraById = new Map(contras.map((c) => [c.id, { id: c.id, date: c.date, reference: c.voucherNo ?? formatUvNo(c.id) }]));   // 5D-7
        const openingContraVoucher = shift.openingContraVoucherId != null ? (contraById.get(shift.openingContraVoucherId) ?? null) : null;
        const closingContraVoucher = shift.closingContraVoucherId != null ? (contraById.get(shift.closingContraVoucherId) ?? null) : null;

        // Per-method tally of everything collected this shift (cash + digital).
        const tenderBreakdown = await buildShiftTenderBreakdown(prisma, {
            counter:  shift.counter,
            openedAt: shift.openedAt,
            closedAt: shift.closedAt,
        });

        return NextResponse.json({
            ...shift,
            openingContraVoucher,
            closingContraVoucher,
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
            refundsPaise:        refundsPaise.toString(),
            runningExpectedPaise: (shift.openingFloatPaise + cashSalesPaise - dropsPaise - expendituresPaise - refundsPaise).toString(),
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
