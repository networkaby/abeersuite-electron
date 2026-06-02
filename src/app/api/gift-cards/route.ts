import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { giftCardIssueSchema } from "@/shared/lib/schemas/giftCardSchemas";
import { nextRefFromSeries, balanceDelta } from "@/modules/accountancy/lib/balance";
import { randomUUID } from "crypto";

// GET /api/gift-cards — list gift cards with balances. Any authed user (POS lookup
// reads via /api/pos/gift-card-lookup); issuing requires coupons:manage.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const cards = await prisma.giftCard.findMany({
            orderBy: { createdAt: "desc" },
            include: { ownerAccount: { select: { name: true } } },
        });
        return NextResponse.json(cards);
    } catch (e) {
        return handleApiError(e, "Failed to fetch gift cards");
    }
}

// POST /api/gift-cards — issue a gift card. Posts Dr <payment ledger> / Cr
// "Gift Card Liability" for initialValue, creates the card + an ISSUE txn.
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.COUPONS_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, giftCardIssueSchema);
    if (error) return error;

    try {
        const config = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        if (config.giftCardLiabilityAccountId == null) {
            return NextResponse.json({ error: "Gift Card Liability ledger not configured. Re-run the bootstrap seed.", code: "GC_LEDGER_MISSING" }, { status: 422 });
        }
        // Debit ledger: the supplied one, else the seeded "Cash" ledger.
        const payAccount = data.paymentAccountId
            ? await prisma.account.findUnique({ where: { id: data.paymentAccountId }, select: { id: true, normalBalance: true } })
            : await prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true, normalBalance: true } });
        if (!payAccount) return NextResponse.json({ error: "Payment ledger not found" }, { status: 422 });

        const liability = await prisma.account.findUniqueOrThrow({ where: { id: config.giftCardLiabilityAccountId }, select: { id: true, normalBalance: true } });

        const code = (data.code?.trim() || `GC-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
        const existing = await prisma.giftCard.findUnique({ where: { code } });
        if (existing) return NextResponse.json({ error: "Gift-card code already exists", code: "GC_DUP" }, { status: 422 });

        const value = data.initialValue;

        const card = await prisma.$transaction(async (tx) => {
            const gc = await tx.giftCard.create({
                data: {
                    code,
                    initialValue: value,
                    balance: value,
                    ownerAccountId: data.ownerAccountId ?? null,
                    expiresAt: data.expiresAt ?? null,
                    createdById: user!.id,
                },
            });

            // Balanced JE: Dr payment ledger / Cr Gift Card Liability.
            const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
            await tx.journalEntry.create({
                data: {
                    date: new Date(),
                    reference: jeRef,
                    description: `Gift card issued: ${code}`,
                    status: "POSTED",
                    postedAt: new Date(),
                    createdById: user!.id,
                    lines: {
                        create: [
                            { accountId: payAccount.id, type: "DEBIT", amount: value, description: `Gift card ${code}` },
                            { accountId: liability.id, type: "CREDIT", amount: value, description: `Gift card ${code}` },
                        ],
                    },
                },
            });
            await tx.account.update({ where: { id: payAccount.id }, data: { balance: { increment: balanceDelta(payAccount.normalBalance ?? "DEBIT", "DEBIT", value) } } });
            await tx.account.update({ where: { id: liability.id }, data: { balance: { increment: balanceDelta(liability.normalBalance ?? "CREDIT", "CREDIT", value) } } });

            await tx.giftCardTxn.create({
                data: { giftCardId: gc.id, type: "ISSUE", amount: value, balanceAfter: value, createdById: user!.id },
            });
            return gc;
        });

        return NextResponse.json(card, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to issue gift card");
    }
}
