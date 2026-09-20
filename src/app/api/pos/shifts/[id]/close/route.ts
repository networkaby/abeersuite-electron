// PATCH /api/pos/shifts/[id]/close
//
// Close a shift and sweep surplus cash to the vault.
//
// Body: { declaredCashPaise, carryOverNextPaise?, notes?, closedAt? }
//
// closedAt — ISO date-time. Manager-only (the force-close tick): a re-close
//   after a wrong close is stamped with the ORIGINAL close moment, not now, so
//   the shift and its Contra / variance Journal fall on the right day in the
//   books. Must sit between openedAt and now. Absent → now.
//
// carryOverNextPaise — how much cash to LEAVE in the counter overnight.
//   Default: the counter's defaultFloatPaise (set once on PosCounter).
//   toVaultPaise = max(0, declared − carryOver)
//
// Steps (one transaction):
//   1. Compute expected = openingFloat + cashSales − drops.
//   2. Compute variance = declared − expected (+ve=over, −ve=short).
//   3. Post variance JE if ≠ 0:
//        over  → Dr Counter till / Cr Cash Over  (income)
//        short → Dr Cash Short   / Cr Counter till (expense)
//   4. Post closing Contra (Counter → Vault) for toVaultPaise,
//      only if toVaultPaise > 0.
//   5. Mark shift CLOSED.
//
// NOTE: No Contra is needed for the carry-over portion — that cash simply
// stays in the counter till GL account (balance remains non-zero overnight).
//
// RE-CLOSE after a reopen: the reopen PARKED the previous close's Contra and
// variance Journal as DRAFTs and left their ids on the shift. So steps 3 and 4
// repost those same rows — same voucher numbers, fresh figures — instead of
// raising new ones. A parked row the corrected close no longer needs (cash now
// matches, or nothing left to sweep) is discarded outright: it never posted, so
// there is no ledger effect, no print and nothing for an audit snapshot to
// protect. See parkVoucherInTx.ts.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { shouldWriteLocal } from "@/shared/lib/prisma/counterMode";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { repostParkedVoucherInTx, discardParkedDraftInTx } from "@/modules/accountancy/lib/parkVoucherInTx";
import { computeExpectedCash, computeVariance, sumPaise, tillBalancePaise, buildShiftTenderBreakdown, listShiftMovements, buildShiftMovementBreakdown, buildShiftCollectionsBreakdown } from "@/modules/pos/lib/shiftMath";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { startOfDayUtc, businessTodayIso } from "@/shared/lib/format/formatDate";
import { stampAttendanceOut } from "@/shared/lib/hr/attendanceStamp";

const closeSchema = z.object({
    declaredCashPaise:  z.number().int().min(0),
    carryOverNextPaise: z.number().int().min(0).optional(), // defaults to counter.defaultFloatPaise
    notes:              z.string().trim().max(500).optional(),
    closedAt:           z.string().datetime({ offset: true }).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, closeSchema);
    if (error) return error;

    try {
        const shift = await prisma.posShift.findUnique({
            where: { id: shiftId },
            include: {
                counter: {
                    include: { tillAccount: { select: { id: true, name: true } } },
                },
                branch: { select: { id: true, name: true, vaultAccountId: true } },
                drops:  { select: { amountPaise: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status === "CLOSED") {
            return NextResponse.json({ error: "Shift is already closed" }, { status: 409 });
        }
        if (shift.status === "AWAITING_HANDOVER") {
            return NextResponse.json(
                { error: "Shift is awaiting handover acceptance. Cancel the handover first or use the accept flow." },
                { status: 409 },
            );
        }
        // Force-close on behalf of the operator is an oversight action: the
        // dedicated `pos:shift:force-close` tick or env super-admin. A plain cashier
        // holds `pos:shift:close` for their OWN shift only.
        const canManage =
            user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
            user!.permissions.includes(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        // Back-dated close (re-close after reopen). Only the manager may date it;
        // a cashier's close is always "now".
        let closedAt = new Date();
        if (data.closedAt !== undefined) {
            if (!canManage) return NextResponse.json({ error: "Only a manager can set the close time" }, { status: 403 });
            closedAt = new Date(data.closedAt);
            if (closedAt.getTime() > Date.now())              return NextResponse.json({ error: "Close time cannot be in the future" }, { status: 400 });
            if (closedAt.getTime() < shift.openedAt.getTime()) return NextResponse.json({ error: "Close time cannot be before the shift opened" }, { status: 400 });
        }
        // GL date of the closing vouchers: the close day (calendar day in the
        // shop's timezone), or the ordinary business date when not back-dated.
        const voucherDate = data.closedAt !== undefined ? startOfDayUtc(businessTodayIso(closedAt)) : requestBusinessDate(req);

        // Resolve carry-over amount — defaults to 0 if not provided in body.
        // The cashier always enters the overnight amount manually; there is no
        // pre-configured default on the counter.
        const carryOverPaise = data.carryOverNextPaise !== undefined
            ? BigInt(data.carryOverNextPaise)
            : BigInt(0);

        const declaredPaise     = BigInt(data.declaredCashPaise);
        const dropsPaise        = sumPaise(shift.drops);
        // Paid out of the drawer this shift — read off the vouchers that carry the
        // shift, so a deleted expenditure stops counting the moment it is deleted.
        const expendituresPaise = sumPaise((await listShiftMovements(prisma, shift.id)).expenditures);
        // Sweep BOTH the counted drawer surplus AND the cash dropped to the safe
        // this shift — both physically leave the counter for the vault, so the
        // till GL closes at exactly the carry-over. (Drops were log-only until
        // now; without this the dropped cash stays stranded in the till GL.)
        //   toVault = declared + drops − carryOver
        const rawToVault = declaredPaise + dropsPaise - carryOverPaise;
        const toVaultPaise = rawToVault > BigInt(0) ? rawToVault : BigInt(0);

        if (toVaultPaise > BigInt(0) && !shift.branch.vaultAccountId) {
            return NextResponse.json({ error: `Branch ${shift.branch.name} has no Vault account configured.` }, { status: 400 });
        }

        // Expected = the till's book balance now − drops. Read AUTHORITATIVE, as
        // shift open does: this figure posts the variance JE, and a counter's
        // replica can lag the last posting by a sync cycle.
        const tillBookBalancePaise = await tillBalancePaise(prismaAuthoritative, shift.counter.tillAccountId);
        const tillMovementPaise    = tillBookBalancePaise - shift.openingFloatPaise;
        const expectedPaise = computeExpectedCash(tillBookBalancePaise, dropsPaise);
        const variancePaise = computeVariance(declaredPaise, expectedPaise);

        const movementBreakdown = await buildShiftMovementBreakdown(prisma, {
            shiftId: shift.id,
            tillAccountId: shift.counter.tillAccountId,
            tillBookBalancePaise,
            openingFloatPaise: shift.openingFloatPaise,
        });

        // Variance ledgers.
        const variance = Number(variancePaise);
        let shortAccountId: number | null = null;
        let overAccountId:  number | null = null;
        if (variance !== 0) {
            const shortAcc = await prisma.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } });
            const overAcc  = await prisma.account.findFirst({ where: { name: "Cash Over"  }, select: { id: true } });
            if (!shortAcc || !overAcc) {
                return NextResponse.json(
                    { error: "Cash Short / Cash Over ledgers missing. Re-run bootstrap seed." },
                    { status: 500 },
                );
            }
            shortAccountId = shortAcc.id;
            overAccountId  = overAcc.id;
        }

        const tillAccountId = shift.counter.tillAccountId;

        // Rows the previous close raised and the reopen parked as DRAFTs. Reused
        // below when the corrected close still needs them, discarded when it does not.
        const parkedContraId   = shift.closingContraVoucherId;
        const parkedVarianceId = shift.varianceJournalEntryId;

        // Re-closing a REOPENED shift rewrites those parked vouchers, and rewriting
        // them means deleting rows — the old GL lines on the repost, the whole draft
        // on a discard. A counter's replica refuses every delete (see the replica
        // write guard in prismaClient.ts: a delete replayed against a row another
        // machine has since changed cannot be recovered), so doing this on a till
        // that has fallen back to local writes would throw from inside the
        // transaction and the cashier would simply be unable to close.
        //
        // Say so before starting instead. This costs an ordinary close nothing —
        // only a reopened shift carries parked ids — and it asks for no more than
        // the reopen already did: that correction was made at the office, on the
        // authoritative database, and finishing it needs the same connection.
        if ((parkedContraId != null || parkedVarianceId != null) && shouldWriteLocal()) {
            return NextResponse.json(
                { error: "This shift was reopened at the office, so closing it again needs the office connection. Try once the counter is back online." },
                { status: 409 },
            );
        }

        const result = await prisma.$transaction(async (tx) => {
            // 3. Variance adjustment JE (counter till is debited/credited to match physical).
            let varianceJeId: number | null = null;
            if (variance !== 0) {
                const absRupees = Math.abs(variance) / 100;
                const lines = variance > 0
                    ? [
                        { accountId: tillAccountId,  type: "DEBIT"  as const, amount: absRupees, description: "Cash drawer over" },
                        { accountId: overAccountId!, type: "CREDIT" as const, amount: absRupees, description: "Cash Over (POS variance)" },
                    ]
                    : [
                        { accountId: shortAccountId!, type: "DEBIT"  as const, amount: absRupees, description: "Cash Short (POS variance)" },
                        { accountId: tillAccountId,   type: "CREDIT" as const, amount: absRupees, description: "Cash drawer short" },
                    ];
                const description = `Shift #${shift.id} variance — ${variance > 0 ? "over" : "short"} ₹${absRupees}`;
                // A parked Journal from the wrong close is reposted in place, so the
                // variance keeps its original voucher number across any number of
                // reopens. Nothing parked (first close, or the row was deleted) →
                // raise a fresh one through the engine as before.
                const reposted = parkedVarianceId != null && await repostParkedVoucherInTx(tx, {
                    voucherId: parkedVarianceId, type: "JOURNAL", date: voucherDate,
                    description, glLines: lines, userId: user!.id, branchId: shift.branch.id,
                });
                if (reposted) {
                    varianceJeId = parkedVarianceId;
                } else {
                    // Variance through the engine (JE + balance deltas + spine in one
                    // place), posted as a JOURNAL voucher. `lines` already matches the
                    // engine's GL-line shape.
                    const { journalEntryId } = await enginePost(tx, {
                        type:        "JOURNAL",
                        date:        voucherDate,
                        description,
                        glLines:     lines,
                        stockMoves:  [],
                    }, user!.id, { branchId: shift.branch.id });
                    varianceJeId = journalEntryId;
                }
            } else if (parkedVarianceId != null) {
                // The corrected count matches: there is no variance to record at all,
                // so the parked draft is dropped rather than reposted as a zero entry.
                await discardParkedDraftInTx(tx, parkedVarianceId);
            }

            // 4. Closing Contra — sweep surplus to vault (only the non-carry-over portion).
            let closingContraId: number | null = null;
            if (toVaultPaise > BigInt(0)) {
                const rupees = Number(toVaultPaise) / 100;
                const narration = `Shift close — ${shift.counter.name} → Vault (${shift.branch.name})`;
                const lines = [
                    { accountId: shift.branch.vaultAccountId!, type: "DEBIT"  as const, amount: rupees, description: "Cash received from counter" },
                    { accountId: tillAccountId,                type: "CREDIT" as const, amount: rupees, description: `Cash swept to vault (keep ₹${Number(carryOverPaise) / 100} in counter)` },
                ];
                // Same rule as the variance Journal: repost the parked Contra in place
                // so the sweep keeps its voucher number, else raise a fresh one.
                const reposted = parkedContraId != null && await repostParkedVoucherInTx(tx, {
                    voucherId: parkedContraId, type: "CONTRA", date: voucherDate,
                    description: narration, narration, glLines: lines, userId: user!.id,
                    branchId: shift.branch.id,
                });
                closingContraId = reposted
                    ? parkedContraId
                    : (await postContra(tx, { date: voucherDate, narration, userId: user!.id, lines, branchId: shift.branch.id })).voucherId;
            } else if (parkedContraId != null) {
                // Nothing left to sweep on the corrected close — drop the parked draft.
                await discardParkedDraftInTx(tx, parkedContraId);
            }

            // 5. Mark shift CLOSED.
            return tx.posShift.update({
                where: { id: shift.id },
                data: {
                    status:                 "CLOSED",
                    closedAt,
                    closedById:             user!.id,
                    declaredCashPaise:      declaredPaise,
                    expectedCashPaise:      expectedPaise,
                    variancePaise:          variancePaise,
                    carryOverNextPaise:     carryOverPaise,
                    toVaultPaise:           toVaultPaise,
                    closingContraVoucherId: closingContraId,
                    varianceJournalEntryId: varianceJeId,
                    notes: data.notes ? (shift.notes ? `${shift.notes}\n${data.notes}` : data.notes) : shift.notes,
                },
                include: {
                    counter: { include: { tillAccount: { select: { id: true, name: true } }, paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } } } },
                    branch:  { select: { id: true, name: true } },
                },
            });
        });

        // HR & People: the close is the cashier's out time for the day. Best-effort.
        await stampAttendanceOut(prisma, shift.userId, closedAt);

        // Per-method tally of everything collected this shift (cash + digital),
        // for the closing report. Uses the real closedAt window.
        const tenderBreakdown = await buildShiftTenderBreakdown(prisma, {
            shiftId: result.id,
            counter: result.counter,
        });

        // Breakdown of all collections across all tenders (sales, receipts, returns)
        const collectionsBreakdown = await buildShiftCollectionsBreakdown(prisma, {
            shiftId: result.id,
            counter: result.counter,
        });

        // Explicit fields only — never spread the Prisma object (BigInt fields
        // like counter.defaultFloatPaise would crash JSON.stringify after the
        // transaction commits, leaving a closed shift with no UI confirmation).
        return NextResponse.json({
            tenderBreakdown,
            id:                  result.id,
            status:              result.status,
            openedAt:            result.openedAt,
            closedAt:            result.closedAt,
            notes:               result.notes,
            openingFloatPaise:   result.openingFloatPaise.toString(),
            carryOverFloatPaise: result.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     result.vaultTopUpPaise.toString(),
            declaredCashPaise:   result.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   result.expectedCashPaise?.toString()  ?? null,
            variancePaise:       result.variancePaise?.toString()      ?? null,
            carryOverNextPaise:  result.carryOverNextPaise?.toString() ?? null,
            toVaultPaise:        result.toVaultPaise?.toString()       ?? null,
            tillBookBalancePaise: tillBookBalancePaise.toString(),
            tillMovementPaise:    tillMovementPaise.toString(),
            dropsPaise:           dropsPaise.toString(),
            expendituresPaise:    expendituresPaise.toString(),
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
            counter: {
                id:   result.counter.id,
                name: result.counter.name,
                tillAccount: { id: result.counter.tillAccount.id, name: result.counter.tillAccount.name },
            },
            branch:              result.branch,
            // Phase 5 5E: the closing contra IS a spine now — resolve by id.
            closingContraVoucher: result.closingContraVoucherId != null
                ? await prisma.universalVoucher.findUnique({ where: { id: result.closingContraVoucherId }, select: { id: true, voucherNo: true } })
                    .then((c) => c ? { id: c.id, reference: c.voucherNo ?? formatUvNo(c.id) } : null)
                : null,
            varianceUniversalVoucherId: result.varianceJournalEntryId,   // spine id (JE dropped)
        });
    } catch (e) {
        return handleApiError(e, "Failed to close shift");
    }
}
