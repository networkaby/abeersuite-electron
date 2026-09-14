// GET /api/pos/shifts/[id]
//
// Full shift detail — header info, drops list, linked Contras, and the live
// drawer figure: the till's book balance (the same read shift OPEN took for the
// opening float) less the shift's drops. Used by ActiveShiftBar polling,
// ShiftCloseDialog, and the audit page.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sumPaise, computeExpectedCash, effectiveBalancePaise, buildShiftTenderBreakdown, listShiftMovements, buildShiftMovementBreakdown, buildShiftCollectionsBreakdown } from "@/modules/pos/lib/shiftMath";
import { EFFECTIVE_BALANCE_SELECT_FIELDS } from "@/modules/accountancy/lib/balance";

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
                        tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
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

        // Live drawer figure straight off the till's book: balance now − drops.
        // Every till movement (sales, receipts, refunds, expenditures) is already
        // on that ledger, so nothing is re-derived per voucher type.
        // Receipts taken and expenditures paid on this shift, straight off the
        // vouchers (digital receipts never touch the till, so cash sales can read
        // ₹0 while the shift still carries them). The detail page uses the counts
        // to know whether the shift can be deleted.
        const movements = await listShiftMovements(prisma, shift.id);
        const dropsPaise           = sumPaise(shift.drops);
        const expendituresPaise    = sumPaise(movements.expenditures);

        // For a closed shift with recorded expected cash, reconstruct the till's book balance
        // at close time (expectedCashPaise + dropsPaise) before the closing Contra sweep ran.
        // For an open / in-progress shift, read the live drawer figure straight off the till account.
        const tillBookBalancePaise = (shift.status === "CLOSED" && shift.expectedCashPaise != null)
            ? shift.expectedCashPaise + dropsPaise
            : effectiveBalancePaise(shift.counter.tillAccount);

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
            shiftId: shift.id,
            counter: shift.counter,
        });

        // Line-by-line breakdown of how the till moved (cash sales, receipts, expenses, refunds, etc.)
        const movementBreakdown = await buildShiftMovementBreakdown(prisma, {
            shiftId: shift.id,
            tillAccountId: shift.counter.tillAccount.id,
            tillBookBalancePaise,
            openingFloatPaise: shift.openingFloatPaise,
        });

        // Breakdown of all collections across all tenders (sales, receipts, returns)
        const collectionsBreakdown = await buildShiftCollectionsBreakdown(prisma, {
            shiftId: shift.id,
            counter: shift.counter,
        });

        return NextResponse.json({
            ...shift,
            openingContraVoucher,
            closingContraVoucher,
            tenderBreakdown,
            movementBreakdown: {
                cashSalesPaise:    movementBreakdown.cashSalesPaise.toString(),
                receiptsPaise:     movementBreakdown.receiptsPaise.toString(),
                expendituresPaise: movementBreakdown.expendituresPaise.toString(),
                refundsPaise:      movementBreakdown.refundsPaise.toString(),
                otherPaise:        movementBreakdown.otherPaise.toString(),
                netMovementPaise:  movementBreakdown.netMovementPaise.toString(),
            },
            collectionsBreakdown: {
                salesPaise:        collectionsBreakdown.salesPaise.toString(),
                salesCount:        collectionsBreakdown.salesCount,
                receiptsPaise:     collectionsBreakdown.receiptsPaise.toString(),
                receiptsCount:     collectionsBreakdown.receiptsCount,
                refundsPaise:      collectionsBreakdown.refundsPaise.toString(),
                refundsCount:      collectionsBreakdown.refundsCount,
                netCollectedPaise: collectionsBreakdown.netCollectedPaise.toString(),
            },
            openingFloatPaise:   shift.openingFloatPaise.toString(),
            carryOverFloatPaise: shift.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     shift.vaultTopUpPaise.toString(),
            declaredCashPaise:   shift.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   shift.expectedCashPaise?.toString()  ?? null,
            variancePaise:       shift.variancePaise?.toString()      ?? null,
            carryOverNextPaise:  shift.carryOverNextPaise?.toString() ?? null,
            toVaultPaise:        shift.toVaultPaise?.toString()       ?? null,
            tillBookBalancePaise: tillBookBalancePaise.toString(),
            tillMovementPaise:    (tillBookBalancePaise - shift.openingFloatPaise).toString(),
            dropsPaise:           dropsPaise.toString(),
            expendituresPaise:    expendituresPaise.toString(),
            runningExpectedPaise: computeExpectedCash(tillBookBalancePaise, dropsPaise).toString(),
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
            expenditures: movements.expenditures.map((e) => ({ ...e, amountPaise: e.amountPaise.toString() })),
            _count: { receipts: movements.receipts.length },
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
