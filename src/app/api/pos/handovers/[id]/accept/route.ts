// POST /api/pos/handovers/[id]/accept
//
// B accepts A's handover. B must be the intended recipient (toUserId).
// Body: { countedByBPaise, notes? }
//
// One atomic transaction:
//   1. Variance JE on A's shift (against the counter till):
//        expected = A's opening + A's cash sales − A's drops
//        variance = A's declared − A's expected  (A's count vs books)
//        discrepancy = A's declared − B's counted (A handed X, B received Y)
//        total variance against counter till = expected − B's counted
//   2. Closing Contra if (B's counted − carryOver) > 0: Counter → Vault
//   3. Close A's shift (status = CLOSED).
//   4. Open B's shift (status = OPEN, openingFloat = B's counted).
//   5. Mark handover ACCEPTED, set toShiftId.
//
// The counter till balance after = B's counted − (B's counted − carryOver) = carryOver ✓
// A is accountable for any gap between books and B's count (shown on A's shift).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { computeExpectedCash, computeVariance, sumPaise } from "@/modules/pos/lib/shiftMath";
import { nextRefFromSeries, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";

const acceptSchema = z.object({
    countedByBPaise: z.number().int().min(0),
    notes:           z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { id: idStr } = await params;
    const handoverId = Number(idStr);
    if (!Number.isFinite(handoverId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, acceptSchema);
    if (error) return error;

    try {
        const handover = await prisma.posHandover.findUnique({
            where:   { id: handoverId },
            include: {
                fromShift: {
                    include: {
                        counter: {
                            include: { tillAccount: { select: { id: true, name: true } } },
                        },
                        branch: { select: { id: true, name: true, vaultAccountId: true } },
                        drops:  { select: { amountPaise: true } },
                    },
                },
            },
        });
        if (!handover) return NextResponse.json({ error: "Handover not found" }, { status: 404 });
        if (handover.status !== "PENDING") {
            return NextResponse.json({ error: `Handover is already ${handover.status.toLowerCase()}` }, { status: 409 });
        }
        if (handover.toUserId !== user!.id) {
            const canManage = user!.permissions.includes(PERMISSIONS.POS_SHIFT_MANAGE) || user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
            if (!canManage) return NextResponse.json({ error: "This handover is not addressed to you" }, { status: 403 });
        }

        const fromShift = handover.fromShift;
        if (fromShift.status !== "AWAITING_HANDOVER") {
            return NextResponse.json({ error: "Source shift is not in AWAITING_HANDOVER state" }, { status: 409 });
        }

        const tillAccountId = fromShift.counter.tillAccountId;
        const counterId     = fromShift.counter.id;
        const branchId      = fromShift.branchId;

        // Cash sales on A's shift.
        const cashPayments = await prisma.payment.findMany({
            where: {
                method:      "CASH",
                status:      "POSTED",
                deletedAt:   null,
                createdById: fromShift.userId,
                createdAt:   { gte: fromShift.openedAt },
            },
            select: { amount: true },
        });
        const cashSalesPaise = cashPayments.reduce(
            (s, p) => s + BigInt(Math.round(Number(p.amount) * 100)),
            BigInt(0),
        );
        const dropsPaise    = sumPaise(fromShift.drops);
        const expectedPaise = computeExpectedCash(fromShift.openingFloatPaise, cashSalesPaise, dropsPaise);

        // Variance = A's declared − expected (A's count vs book expectation).
        // The total impact on the counter till = expected − B's counted
        // (what books say should be there vs what B physically received).
        const declaredA   = handover.declaredByAPaise;
        const countedB    = BigInt(data.countedByBPaise);
        const carryOver   = handover.carryOverPaise;

        // The till needs to be reconciled to B's counted amount.
        // variancePaise for A's shift: what A declared vs what books expected.
        const variancePaise = computeVariance(declaredA, expectedPaise);

        // How much goes to vault = B's counted minus carry-over.
        const rawToVault  = countedB - carryOver;
        const toVaultPaise = rawToVault > BigInt(0) ? rawToVault : BigInt(0);

        if (toVaultPaise > BigInt(0) && !fromShift.branch.vaultAccountId) {
            return NextResponse.json({ error: `Branch ${fromShift.branch.name} has no Vault account configured.` }, { status: 400 });
        }

        // Need variance ledgers if any discrepancy.
        // The counter till discrepancy = expected − countedB (total between books and physical).
        const tillDiscrepancy = Number(expectedPaise) - Number(countedB);
        let shortAccountId: number | null = null;
        let overAccountId:  number | null = null;
        if (tillDiscrepancy !== 0) {
            const shortAcc = await prisma.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } });
            const overAcc  = await prisma.account.findFirst({ where: { name: "Cash Over"  }, select: { id: true } });
            if (!shortAcc || !overAcc) {
                return NextResponse.json({ error: "Cash Short / Cash Over ledgers missing. Re-run bootstrap seed." }, { status: 500 });
            }
            shortAccountId = shortAcc.id;
            overAccountId  = overAcc.id;
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Variance JE — reconcile counter till to B's physical count.
            let varianceJeId: number | null = null;
            if (tillDiscrepancy !== 0) {
                const absRupees = Math.abs(tillDiscrepancy) / 100;
                const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
                const lines = tillDiscrepancy > 0
                    // Books say more than B counted → counter short (shortage is A's accountability).
                    ? [
                        { accountId: shortAccountId!, type: "DEBIT"  as const, amount: absRupees, description: `Cash Short — Shift #${fromShift.id} handover discrepancy` },
                        { accountId: tillAccountId,   type: "CREDIT" as const, amount: absRupees, description: `Counter till adjusted to B's count` },
                    ]
                    // B counted more than books → counter over.
                    : [
                        { accountId: tillAccountId,  type: "DEBIT"  as const, amount: absRupees, description: `Counter till adjusted to B's count (over)` },
                        { accountId: overAccountId!, type: "CREDIT" as const, amount: absRupees, description: `Cash Over — Shift #${fromShift.id} handover` },
                    ];
                const varianceJe = await tx.journalEntry.create({
                    data: {
                        date:        new Date(),
                        reference:   jeRef,
                        description: `Shift #${fromShift.id} handover variance — ${tillDiscrepancy > 0 ? "short" : "over"} ₹${absRupees}`,
                        status:      "POSTED",
                        postedAt:    new Date(),
                        createdById: user!.id,
                        lines: { create: lines.map((l) => ({ accountId: l.accountId, type: l.type, amount: l.amount, description: l.description })) },
                    },
                    select: { id: true },
                });
                // Balance deltas.
                const accountIds = lines.map((l) => l.accountId);
                const accounts = await tx.account.findMany({
                    where:  { id: { in: accountIds } },
                    select: { id: true, normalBalance: true },
                });
                const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));
                for (const line of lines) {
                    const normal = normalById.get(line.accountId)!;
                    const delta  = balanceDelta(normal, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                }
                varianceJeId = varianceJe.id;
            }

            // 2. Closing Contra — sweep surplus to vault.
            let closingContraId: number | null = null;
            if (toVaultPaise > BigInt(0)) {
                const rupees = Number(toVaultPaise) / 100;
                const closing = await postContra(tx, {
                    date:      new Date(),
                    narration: `Handover close — ${fromShift.counter.name} → Vault (${fromShift.branch.name})`,
                    userId:    user!.id,
                    lines: [
                        { accountId: fromShift.branch.vaultAccountId!, type: "DEBIT",  amount: rupees, description: "Cash swept to vault on handover" },
                        { accountId: tillAccountId,                     type: "CREDIT", amount: rupees, description: `Counter till surplus (keep ₹${Number(carryOver) / 100} as carry-over)` },
                    ],
                });
                closingContraId = closing.voucherId;
            }

            // 3. Close A's shift.
            const closedA = await tx.posShift.update({
                where: { id: fromShift.id },
                data: {
                    status:                 "CLOSED",
                    closedAt:               new Date(),
                    closedById:             user!.id,                     // B closes A's shift on accept
                    declaredCashPaise:      declaredA,
                    expectedCashPaise:      expectedPaise,
                    variancePaise:          variancePaise,
                    carryOverNextPaise:     carryOver,
                    toVaultPaise:           toVaultPaise,
                    closingContraVoucherId: closingContraId,
                    varianceJournalEntryId: varianceJeId,
                },
            });

            // 4. Open B's shift at the same counter.
            const openedB = await tx.posShift.create({
                data: {
                    userId:             user!.id,
                    counterId,
                    branchId,
                    openedById:         user!.id,
                    openingFloatPaise:  countedB,
                    carryOverFloatPaise: countedB,   // all of B's start is carry-over from handover
                    vaultTopUpPaise:    BigInt(0),
                    // B's opening contra = A's closing contra (same physical event)
                    openingContraVoucherId: null,
                    notes: data.notes ?? null,
                },
            });

            // 5. Wire handover links.
            await tx.posHandover.update({
                where: { id: handoverId },
                data: {
                    status:          "ACCEPTED",
                    countedByBPaise: countedB,
                    toShiftId:       openedB.id,
                    acceptedAt:      new Date(),
                },
            });
            await tx.posShift.update({
                where: { id: fromShift.id },
                data:  { handoverToShiftId: openedB.id },
            });

            return { closedShift: closedA, openedShift: openedB };
        });

        return NextResponse.json({
            handoverAccepted:  true,
            closedShiftId:     result.closedShift.id,
            openedShiftId:     result.openedShift.id,
            openingFloatPaise: result.openedShift.openingFloatPaise.toString(),
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to accept handover");
    }
}
