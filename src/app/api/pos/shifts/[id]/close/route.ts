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
import { computeExpectedCash, computeVariance, sumPaise } from "@/modules/pos/lib/shiftMath";
import { nextRefFromSeries, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";

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

        const declaredPaise = BigInt(data.declaredCashPaise);
        // How much actually sweeps to vault = declared minus the carry-over left behind.
        const rawToVault = declaredPaise - carryOverPaise;
        const toVaultPaise = rawToVault > BigInt(0) ? rawToVault : BigInt(0);

        if (toVaultPaise > BigInt(0) && !shift.branch.vaultAccountId) {
            return NextResponse.json({ error: `Branch ${shift.branch.name} has no Vault account configured.` }, { status: 400 });
        }

        // Cash-sales total.
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
        const expectedPaise = computeExpectedCash(shift.openingFloatPaise, cashSalesPaise, dropsPaise);
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
                const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
                const lines = variance > 0
                    ? [
                        { accountId: tillAccountId,  type: "DEBIT"  as const, amount: absRupees, description: "Cash drawer over" },
                        { accountId: overAccountId!, type: "CREDIT" as const, amount: absRupees, description: "Cash Over (POS variance)" },
                    ]
                    : [
                        { accountId: shortAccountId!, type: "DEBIT"  as const, amount: absRupees, description: "Cash Short (POS variance)" },
                        { accountId: tillAccountId,   type: "CREDIT" as const, amount: absRupees, description: "Cash drawer short" },
                    ];
                const varianceJe = await tx.journalEntry.create({
                    data: {
                        date:        new Date(),
                        reference:   jeRef,
                        description: `Shift #${shift.id} variance — ${variance > 0 ? "over" : "short"} ₹${Math.abs(variance) / 100}`,
                        status:      "POSTED",
                        postedAt:    new Date(),
                        createdById: user!.id,
                        lines: { create: lines.map((l) => ({ accountId: l.accountId, type: l.type, amount: l.amount, description: l.description })) },
                    },
                    select: { id: true },
                });
                // Balance deltas for the variance JE.
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
                    counter: { include: { tillAccount: { select: { id: true, name: true } } } },
                    branch:  { select: { id: true, name: true } },
                    closingContraVoucher: { select: { id: true, reference: true } },
                    varianceJournalEntry: { select: { id: true, reference: true } },
                },
            });
        });

        // Explicit fields only — never spread the Prisma object (BigInt fields
        // like counter.defaultFloatPaise would crash JSON.stringify after the
        // transaction commits, leaving a closed shift with no UI confirmation).
        return NextResponse.json({
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
            counter: {
                id:   result.counter.id,
                name: result.counter.name,
                tillAccount: { id: result.counter.tillAccount.id, name: result.counter.tillAccount.name },
            },
            branch:              result.branch,
            closingContraVoucher: result.closingContraVoucher,
            varianceJournalEntry: result.varianceJournalEntry,
        });
    } catch (e) {
        return handleApiError(e, "Failed to close shift");
    }
}
