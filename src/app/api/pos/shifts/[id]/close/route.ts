// PATCH /api/pos/shifts/[id]/close
//
// Close a shift and sweep surplus cash to the vault.
//
// Body: { declaredCashPaise, carryOverNextPaise?, notes? }
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

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { computeExpectedCash, computeVariance, sumPaise, sumShiftCashSalesPaise, buildShiftTenderBreakdown } from "@/modules/pos/lib/shiftMath";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";

const closeSchema = z.object({
    declaredCashPaise:  z.number().int().min(0),
    carryOverNextPaise: z.number().int().min(0).optional(), // defaults to counter.defaultFloatPaise
    notes:              z.string().trim().max(500).optional(),
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
                expenditures: { select: { amountPaise: true } },
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
        const canManage = user!.permissions.includes(PERMISSIONS.POS_SHIFT_MANAGE) || user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        // Resolve carry-over amount — defaults to 0 if not provided in body.
        // The cashier always enters the overnight amount manually; there is no
        // pre-configured default on the counter.
        const carryOverPaise = data.carryOverNextPaise !== undefined
            ? BigInt(data.carryOverNextPaise)
            : BigInt(0);

        const declaredPaise     = BigInt(data.declaredCashPaise);
        const dropsPaise        = sumPaise(shift.drops);
        const expendituresPaise = sumPaise(shift.expenditures);
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

        // Cash-sales total — sum of debits to the counter till from receipt
        // vouchers in this shift window (replaces the legacy Payment query).
        const cashSalesPaise = await sumShiftCashSalesPaise(prisma, {
            tillAccountId: shift.counter.tillAccountId,
            openedAt:      shift.openedAt,
        });
        const expectedPaise = computeExpectedCash(shift.openingFloatPaise, cashSalesPaise, dropsPaise, expendituresPaise);
        const variancePaise = computeVariance(declaredPaise, expectedPaise);

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
                // Variance through the engine (JE + balance deltas + spine in one
                // place), posted as a JOURNAL voucher. `lines` already matches the
                // engine's GL-line shape.
                const { journalEntryId } = await enginePost(tx, {
                    type:        "JOURNAL",
                    date:        new Date(),
                    description: `Shift #${shift.id} variance — ${variance > 0 ? "over" : "short"} ₹${absRupees}`,
                    glLines:     lines,
                    stockMoves:  [],
                }, user!.id);
                varianceJeId = journalEntryId;
            }

            // 4. Closing Contra — sweep surplus to vault (only the non-carry-over portion).
            let closingContraId: number | null = null;
            if (toVaultPaise > BigInt(0)) {
                const rupees = Number(toVaultPaise) / 100;
                const closing = await postContra(tx, {
                    date:      new Date(),
                    narration: `Shift close — ${shift.counter.name} → Vault (${shift.branch.name})`,
                    userId:    user!.id,
                    lines: [
                        { accountId: shift.branch.vaultAccountId!, type: "DEBIT",  amount: rupees, description: "Cash received from counter" },
                        { accountId: tillAccountId,                 type: "CREDIT", amount: rupees, description: `Cash swept to vault (keep ₹${Number(carryOverPaise) / 100} in counter)` },
                    ],
                });
                closingContraId = closing.voucherId;
            }

            // 5. Mark shift CLOSED.
            return tx.posShift.update({
                where: { id: shift.id },
                data: {
                    status:                 "CLOSED",
                    closedAt:               new Date(),
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

        // Per-method tally of everything collected this shift (cash + digital),
        // for the closing report. Uses the real closedAt window.
        const tenderBreakdown = await buildShiftTenderBreakdown(prisma, {
            counter:  result.counter,
            openedAt: result.openedAt,
            closedAt: result.closedAt,
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
            cashSalesPaise:      cashSalesPaise.toString(),
            dropsPaise:          dropsPaise.toString(),
            expendituresPaise:   expendituresPaise.toString(),
            counter: {
                id:   result.counter.id,
                name: result.counter.name,
                tillAccount: { id: result.counter.tillAccount.id, name: result.counter.tillAccount.name },
            },
            branch:              result.branch,
            // Phase 5 5E: the closing contra IS a spine now — resolve by id.
            closingContraVoucher: result.closingContraVoucherId != null
                ? await prisma.universalVoucher.findUnique({ where: { id: result.closingContraVoucherId }, select: { id: true, reference: true } })
                : null,
            varianceUniversalVoucherId: result.varianceJournalEntryId,   // spine id (JE dropped)
        });
    } catch (e) {
        return handleApiError(e, "Failed to close shift");
    }
}
