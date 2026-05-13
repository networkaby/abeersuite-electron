// PATCH /api/pos/shifts/[id]/close
//
// Close a shift and hand cash over to the manager.
//
// Body: { declaredCashPaise, notes? }
//
// Steps (all in one transaction):
//   1. Load shift + sum of CASH-method Payment rows in window + sum of drops.
//   2. Compute expected = openingFloat + cashSales − drops.
//   3. Compute variance = declared − expected. Positive = drawer over,
//      negative = drawer short.
//   4. Post closing Contra (Cr Till = declaredCashPaise, Dr Vault) — the
//      physical cash actually handed to the manager.
//   5. If variance ≠ 0, post a tiny adjustment JE:
//        • variance > 0 (over):  Dr Till / Cr Cash Over    (income)
//        • variance < 0 (short): Dr Cash Short / Cr Till   (expense)
//      so the till account zeroes out by EOD.
//   6. Mark shift CLOSED with audit fields populated.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { computeExpectedCash, computeVariance, sumPaise } from "@/modules/pos/lib/shiftMath";
import { nextRef, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";

const closeSchema = z.object({
    declaredCashPaise: z.number().int().min(0),
    notes:             z.string().trim().max(500).optional(),
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
                branch:      { select: { id: true, name: true, vaultAccountId: true } },
                tillAccount: { select: { id: true, name: true } },
                drops:       { select: { amountPaise: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "OPEN") {
            return NextResponse.json({ error: "Shift is already closed" }, { status: 409 });
        }
        const canManage = user!.permissions.includes(PERMISSIONS.POS_SHIFT_MANAGE) || user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }
        if (!shift.branch.vaultAccountId) {
            return NextResponse.json({ error: `Branch ${shift.branch.name} has no Vault account configured.` }, { status: 400 });
        }

        // Cash-sales total — same query as the detail endpoint.
        const cashPayments = await prisma.payment.findMany({
            where: {
                method:      "CASH",
                status:      "POSTED",
                deletedAt:   null,
                createdById: shift.userId,
                createdAt:   { gte: shift.openedAt },
            },
            select: { amount: true },
        });
        const cashSalesPaise = cashPayments.reduce(
            (s, p) => s + BigInt(Math.round(Number(p.amount) * 100)),
            BigInt(0),
        );
        const dropsPaise    = sumPaise(shift.drops);
        const declaredPaise = BigInt(data.declaredCashPaise);
        const expectedPaise = computeExpectedCash(shift.openingFloatPaise, cashSalesPaise, dropsPaise);
        const variancePaise = computeVariance(declaredPaise, expectedPaise);

        // Need both Cash Short and Cash Over ledgers if variance ≠ 0.
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

        const result = await prisma.$transaction(async (tx) => {
            // 4. Closing Contra — physical cash actually transferred. Amount is
            //    `declaredPaise`, not `expectedPaise`. This is what the manager
            //    received, period.
            let closingContraId: number | null = null;
            if (declaredPaise > BigInt(0)) {
                const rupees = Number(declaredPaise) / 100;
                const closing = await postContra(tx, {
                    date:      new Date(),
                    narration: `Shift close — ${shift.tillAccount.name} → Vault (${shift.branch.name})`,
                    userId:    user!.id,
                    lines: [
                        { accountId: shift.branch.vaultAccountId!, type: "DEBIT",  amount: rupees, description: "Cash received from cashier" },
                        { accountId: shift.tillAccountId,          type: "CREDIT", amount: rupees, description: "Cash handed to manager" },
                    ],
                });
                closingContraId = closing.voucherId;
            }

            // 5. Variance adjustment — only when declared ≠ expected.
            let varianceJeId: number | null = null;
            if (variance !== 0) {
                const absRupees = Math.abs(variance) / 100;
                const jeRef = await nextRef(tx, "journalEntry", "JE");
                const lines = variance > 0
                    // Over — extra cash counted; Dr Till / Cr Cash Over (income).
                    ? [
                        { accountId: shift.tillAccountId, type: "DEBIT"  as const, amount: absRupees, description: "Cash drawer over" },
                        { accountId: overAccountId!,      type: "CREDIT" as const, amount: absRupees, description: "Cash Over (POS variance)" },
                    ]
                    // Short — drawer light; Dr Cash Short (expense) / Cr Till.
                    : [
                        { accountId: shortAccountId!,     type: "DEBIT"  as const, amount: absRupees, description: "Cash Short (POS variance)" },
                        { accountId: shift.tillAccountId, type: "CREDIT" as const, amount: absRupees, description: "Cash drawer short" },
                    ];
                const varianceJe = await tx.journalEntry.create({
                    data: {
                        date:        new Date(),
                        reference:   jeRef,
                        description: `Shift #${shift.id} variance — ${variance > 0 ? "over" : "short"} ₹${absRupees}`,
                        status:      "POSTED",
                        postedAt:    new Date(),
                        createdById: user!.id,
                        lines: { create: lines.map((l) => ({ accountId: l.accountId, type: l.type, amount: l.amount, description: l.description })) },
                    },
                    select: { id: true },
                });
                // Apply balance deltas for the variance JE (postContra does this
                // automatically, but this is a raw JE so we do it manually).
                const accountIds = lines.map((l) => l.accountId);
                const accounts = await tx.account.findMany({
                    where:  { id: { in: accountIds } },
                    select: { id: true, normalBalance: true },
                });
                const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));
                for (const line of lines) {
                    const normal = normalById.get(line.accountId)!;
                    const delta = balanceDelta(normal, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                }
                varianceJeId = varianceJe.id;
            }

            // 6. Mark shift CLOSED.
            return tx.posShift.update({
                where: { id: shift.id },
                data: {
                    status:                 "CLOSED",
                    closedAt:               new Date(),
                    closedById:             user!.id,
                    declaredCashPaise:      declaredPaise,
                    expectedCashPaise:      expectedPaise,
                    variancePaise:          variancePaise,
                    closingContraVoucherId: closingContraId,
                    varianceJournalEntryId: varianceJeId,
                    notes: data.notes ? (shift.notes ? `${shift.notes}\n${data.notes}` : data.notes) : shift.notes,
                },
                include: {
                    tillAccount: { select: { id: true, name: true } },
                    branch:      { select: { id: true, name: true } },
                    closingContraVoucher: { select: { id: true, reference: true } },
                    varianceJournalEntry: { select: { id: true, reference: true } },
                },
            });
        });

        return NextResponse.json({
            ...result,
            openingFloatPaise: result.openingFloatPaise.toString(),
            declaredCashPaise: result.declaredCashPaise?.toString() ?? null,
            expectedCashPaise: result.expectedCashPaise?.toString() ?? null,
            variancePaise:     result.variancePaise?.toString() ?? null,
            cashSalesPaise:    cashSalesPaise.toString(),
            dropsPaise:        dropsPaise.toString(),
        });
    } catch (e) {
        return handleApiError(e, "Failed to close shift");
    }
}
