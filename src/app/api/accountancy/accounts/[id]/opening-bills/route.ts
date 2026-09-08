import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    loadOpeningBills, saveOpeningBills, defaultOpeningDateIso, DEFAULT_OPENING_REF, OpeningBillError,
} from "@/modules/accountancy/lib/openingBills";

// GET  /api/accountancy/accounts/[id]/opening-bills — the party's opening bills
// PUT  /api/accountancy/accounts/[id]/opening-bills — replace them
//
// A party's opening balance is either ONE number on the master (as it always
// was) or the several bills it really was. This is the second form. Saving here
// moves the account off the scalar, so the two can never both count.
//
// The Balance Sheet's "Difference in Opening Balances" is a synthetic line over
// the remaining SCALAR openings, so it shrinks by exactly what the converted
// account's voucher posts to Suspense A/c. The sheet still balances; the amount
// simply becomes a real ledger. (`reconcileOpeningSuspense` is deliberately not
// called: it looks up a ledger the seed forbids creating, so it has never done
// anything.)

const putSchema = z.object({
    /** Which side the opening sits on — one side per party, as on the master. */
    type:  z.enum(["DEBIT", "CREDIT"]),
    bills: z.array(z.object({
        universalVoucherId: z.number().int().positive().optional(),
        ref:                z.string().trim().max(60),
        date:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
        amount:             z.number().positive(),
    })).max(500),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId) || accountId <= 0) {
        return NextResponse.json({ error: "Bad account id" }, { status: 400 });
    }

    try {
        const account = await prisma.account.findUnique({
            where:  { id: accountId },
            select: { id: true, name: true, openingBalance: true, openingBalanceType: true },
        });
        if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const bills = await loadOpeningBills(prisma, accountId);
        return NextResponse.json({
            accountId,
            accountName: account.name,
            // The master figure, present only while this party is still on the
            // scalar form. Once bills exist it is null and the bills are the truth.
            scalarOpening:     account.openingBalance != null ? Number(account.openingBalance) : null,
            scalarOpeningType: account.openingBalanceType,
            bills,
            defaults: { ref: DEFAULT_OPENING_REF, date: defaultOpeningDateIso() },
        });
    } catch (e) {
        return handleApiError(e, "Failed to load opening bills");
    }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId) || accountId <= 0) {
        return NextResponse.json({ error: "Bad account id" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;

    try {
        const result = await prisma.$transaction(
            (tx) => saveOpeningBills(tx, {
                accountId,
                type:   data.type,
                bills:  data.bills,
                userId: user!.id,
            }),
            { timeout: 30_000, maxWait: 10_000 },
        );

        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        if (e instanceof OpeningBillError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to save opening bills");
    }
}
