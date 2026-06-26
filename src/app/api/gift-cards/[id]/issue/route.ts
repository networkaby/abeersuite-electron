import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { giftCardIssueSchema } from "@/shared/lib/schemas/giftCardSchemas";
import { nextRefFromSeries, balanceDelta } from "@/modules/accountancy/lib/balance";
import { mirrorJeToSpine } from "@/modules/accountancy/lib/transactionEngine";

// POST /api/gift-cards/[id]/issue — SELL a DRAFT card. Posts a balanced JE
// Dr <payment ledger> / Cr "Gift Card Liability" for the card's value, writes an
// ISSUE txn, and flips the card DRAFT → ACTIVE. This is the moment money is taken.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.COUPONS_MANAGE);
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

        const issued = await prisma.$transaction(async (tx) => {
            // Balanced JE: Dr payment ledger / Cr Gift Card Liability.
            const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
            const issueJe = await tx.journalEntry.create({
                data: {
                    date: new Date(),
                    reference: jeRef,
                    description: `Gift card sold: ${card.code}`,
                    status: "POSTED",
                    postedAt: new Date(),
                    createdById: user!.id,
                    lines: {
                        create: [
                            { accountId: payAccount.id, type: "DEBIT", amount: value, description: `Gift card ${card.code}` },
                            { accountId: liability.id, type: "CREDIT", amount: value, description: `Gift card ${card.code}` },
                        ],
                    },
                },
            });
            // Phase 4: mirror the gift-card issue JE into the spine.
            await mirrorJeToSpine(tx, issueJe.id, { type: "JOURNAL", friendlyRef: jeRef });
            await tx.account.update({ where: { id: payAccount.id }, data: { balance: { increment: balanceDelta(payAccount.normalBalance ?? "DEBIT", "DEBIT", value) } } });
            await tx.account.update({ where: { id: liability.id }, data: { balance: { increment: balanceDelta(liability.normalBalance ?? "CREDIT", "CREDIT", value) } } });

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
