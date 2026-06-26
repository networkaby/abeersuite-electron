import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";

// POST /api/gift-cards/expire-breakage — recognise breakage on every ACTIVE card
// that is past its expiry with a leftover balance. For each: Dr "Gift Card
// Liability" / Cr "Gift Card Breakage" (income) for the remaining balance, write
// an EXPIRE txn, zero the balance, set status EXPIRED. Admin-triggered (a button
// on the Gift Cards page); also safe to call from a scheduled job (GitHub Action).
export async function POST() {
    const { user, response } = await requirePermission(PERMISSIONS.COUPONS_MANAGE);
    if (response) return response;

    try {
        const config = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        if (config.giftCardLiabilityAccountId == null || config.giftCardBreakageAccountId == null) {
            return NextResponse.json({ error: "Gift Card Liability / Breakage ledgers not configured. Re-run the bootstrap seed.", code: "GC_LEDGER_MISSING" }, { status: 422 });
        }

        const now = new Date();
        const due = await prisma.giftCard.findMany({
            where: { status: "ACTIVE", expiresAt: { not: null, lt: now }, balance: { gt: 0 } },
            select: { id: true, code: true, balance: true },
        });
        if (due.length === 0) return NextResponse.json({ ok: true, expired: 0, total: 0 });

        const [liability, breakage] = await Promise.all([
            prisma.account.findUniqueOrThrow({ where: { id: config.giftCardLiabilityAccountId }, select: { id: true, normalBalance: true } }),
            prisma.account.findUniqueOrThrow({ where: { id: config.giftCardBreakageAccountId }, select: { id: true, normalBalance: true } }),
        ]);

        let total = 0;
        await prisma.$transaction(async (tx) => {
            for (const gc of due) {
                const amt = Number(gc.balance);
                // Dr Gift Card Liability / Cr Breakage Income — through the engine
                // (JE + balances + spine in one place). Posts as a JOURNAL voucher.
                await enginePost(tx, {
                    type:        "JOURNAL",
                    date:        now,
                    description: `Gift card breakage: ${gc.code}`,
                    glLines: [
                        { accountId: liability.id, type: "DEBIT",  amount: amt, description: `Gift card ${gc.code} expired` },
                        { accountId: breakage.id,  type: "CREDIT", amount: amt, description: `Gift card ${gc.code} breakage` },
                    ],
                    stockMoves: [],
                }, user!.id);
                await tx.giftCardTxn.create({
                    data: { giftCardId: gc.id, type: "EXPIRE", amount: -amt, balanceAfter: 0, createdById: user!.id },
                });
                await tx.giftCard.update({ where: { id: gc.id }, data: { balance: 0, status: "EXPIRED" } });
                total += amt;
            }
        });

        return NextResponse.json({ ok: true, expired: due.length, total: Math.round(total * 100) / 100 });
    } catch (e) {
        return handleApiError(e, "Failed to recognise gift-card breakage");
    }
}
