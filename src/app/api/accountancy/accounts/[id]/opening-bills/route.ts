import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { round2 } from "@/shared/lib/format";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    loadOpeningBills, saveOpeningBills, defaultOpeningDateIso, DEFAULT_OPENING_REF, OpeningBillError,
} from "@/modules/accountancy/lib/openingBills";
import { partyLedgerIds } from "@/modules/accountancy/lib/accountGroups";

// GET  /api/accountancy/accounts/[id]/opening-bills — the party's opening bills
// PUT  /api/accountancy/accounts/[id]/opening-bills — replace them
//
// A party's opening balance is either ONE number on the master (as it always
// was) or the several bills it really was. This is the second form. Saving here
// moves the account off the scalar, so the two can never both count.
//
// An opening bill posts the party's leg only — no counter-entry anywhere — so
// the Trial Balance and Balance Sheet show whatever the openings disagree by as
// their computed "Difference in opening balances" line, same as for scalar
// openings. (`reconcileOpeningSuspense` is deliberately not called: it looks up
// a ledger the seed forbids creating, so it has never done anything.)

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

        const [bills, partyIds] = await Promise.all([
            loadOpeningBills(prisma, accountId),
            partyLedgerIds(),
        ]);
        return NextResponse.json({
            accountId,
            accountName: account.name,
            // Bill-wise is a party idea; every caller can mount the editor and
            // let this decide, instead of each one re-deriving the group walk.
            isParty: partyIds.has(accountId),
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

/**
 * The one rewrite that needs no tick: a Receipt / Payment settling a one-figure
 * opening first turns it into ONE bill of the same side and amount
 * (settleFromPicks). Nothing the party owes moves, so the cashier taking the money
 * needs no masters tick. Anything else — several bills, another figure, bills
 * already there — is a real rewrite.
 */
async function isSameFigureSplit(accountId: number, put: z.infer<typeof putSchema>): Promise<boolean> {
    if (put.bills.length !== 1 || put.bills[0].universalVoucherId != null) return false;
    const [account, existing] = await Promise.all([
        prisma.account.findUnique({
            where:  { id: accountId },
            select: { openingBalance: true, openingBalanceType: true },
        }),
        loadOpeningBills(prisma, accountId),
    ]);
    if (!account || account.openingBalance == null || existing.length > 0) return false;
    return account.openingBalanceType === put.type
        && round2(Math.abs(Number(account.openingBalance))) === round2(put.bills[0].amount);
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

    // Rewriting a party's opening moves what they owed before the books began, so it
    // rides the ticks of the one-figure editors: Accountancy Masters Edit (Opening
    // Balance page, Edit Ledger) or Contacts Delete (the Contacts profile card).
    const mayRewrite = hasPermission(user, PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT)
        || hasPermission(user, PERMISSIONS.CUSTOMERS_DELETE);
    if (!mayRewrite && !(await isSameFigureSplit(accountId, data))) {
        return NextResponse.json({ error: "You do not have permission to change this party's opening balance." }, { status: 403 });
    }

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
