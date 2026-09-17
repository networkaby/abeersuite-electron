import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { giftCardIssueSchema } from "@/shared/lib/schemas/giftCardSchemas";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { auth } from "@/auth";
import { requireWritableBranchId } from "@/shared/lib/auth/activeBranch";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";

// POST /api/gift-cards/[id]/issue — SELL a DRAFT card. Posts a balanced JE
// Dr <payment ledger> / Cr "Gift Card Liability" for the card's value, writes an
// ISSUE txn, and flips the card DRAFT → ACTIVE. This is the moment money is taken.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Issuing (selling) a card is part of editing it — activates + loads balance.
    const { user, response } = await requireAnyPermission(PERMISSIONS.GIFT_CARDS_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, giftCardIssueSchema);
    if (error) return error;

    try {
        const config = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        if (config.giftCardLiabilityAccountId == null) {
            return NextResponse.json({ error: "Gift Card Liability ledger not configured. Re-run the bootstrap seed.", code: "GC_LEDGER_MISSING" }, { status: 422 });
        }

        const card = await prisma.giftCard.findUnique({ where: { id }, select: { id: true, code: true, status: true, initialValue: true } });
        if (!card) return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
        if (card.status !== "DRAFT") {
            return NextResponse.json({ error: "Only draft gift cards can be issued", code: "GC_NOT_DRAFT" }, { status: 409 });
        }

        // Debit ledger: the supplied one, else the seeded "Cash" ledger.
        const payAccount = data.paymentAccountId
            ? await prisma.account.findUnique({ where: { id: data.paymentAccountId }, select: { id: true, normalBalance: true } })
            : await prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true, normalBalance: true } });
        if (!payAccount) return NextResponse.json({ error: "Payment ledger not found" }, { status: 422 });

        const liability = await prisma.account.findUniqueOrThrow({ where: { id: config.giftCardLiabilityAccountId }, select: { id: true, normalBalance: true } });
        const value = Number(card.initialValue);

        // A card is issued from a till or a desk, so it has a working branch like
        // any other voucher — "All branches" is refused rather than saved blank.
        const branchId = requireWritableBranchId(req, await auth());

        const issued = await prisma.$transaction(async (tx) => {
            // Dr payment ledger / Cr Gift Card Liability — through the engine
            // (writes the JE + balance deltas + universal-voucher spine in one
            // place). Posts as a JOURNAL voucher (no dedicated gift-card voucher
            // UI yet; the description carries the meaning).
            await enginePost(tx, {
                type:        "JOURNAL",
                date:        requestBusinessDate(req),
                description: `Gift card sold: ${card.code}`,
                glLines: [
                    { accountId: payAccount.id, type: "DEBIT",  amount: value, description: `Gift card ${card.code}` },
                    { accountId: liability.id,  type: "CREDIT", amount: value, description: `Gift card ${card.code}` },
                ],
                stockMoves: [],
            }, user!.id, { branchId });

            await tx.giftCardTxn.create({
                data: { giftCardId: card.id, type: "ISSUE", amount: value, balanceAfter: value, createdById: user!.id },
            });
            return tx.giftCard.update({
                where: { id: card.id },
                data: { status: "ACTIVE", issuedAt: new Date() },
                include: { ownerAccount: { select: { name: true } } },
            });
        });

        return NextResponse.json(issued);
    } catch (e) {
        return handleApiError(e, "Failed to issue gift card");
    }
}
