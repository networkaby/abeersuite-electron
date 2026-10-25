import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { isoDateSchema } from "@/shared/lib/schemas";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    saveOpeningBills, defaultOpeningDateIso, DEFAULT_OPENING_REF, OPENING_TYPE, OpeningBillError,
} from "@/modules/accountancy/lib/openingBills";
import { accountIdsUnderGroup } from "@/modules/accountancy/lib/accountGroups";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// POST /api/accountancy/opening-balance/to-bills
//
// Turn every party's master opening figure into ONE opening bill, so all of it
// becomes visible in Receivables and Payables and can be settled against. The
// breakup into several real bills comes later, party by party, in the bill-wise
// editor — this only gets the money out of the invisible scalar.
//
// Party ledgers only. An opening on Cash or Capital is not a "bill" and has
// nothing to age or settle, so it stays exactly as it is.
//
// `dryRun` (the default) reports what would happen and writes nothing. Ask for
// it first. The party's balance does not move: the summed ledger counts the
// master opening and an opening bill alike.
const schema = z.object({
    dryRun: z.boolean().default(true),
    /** Date every created bill carries. Defaults to the start of this financial year. */
    date:   isoDateSchema.optional(),
    /** Bill number for the single bill. Defaults to "Opening Balance". */
    ref:    z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    // The preview is a read and stays open. Converting rewrites every party's
    // opening at once, so it needs the Opening Balance page's own tick — the same
    // one its single-figure editor (`accounts/[id]/opening`) checks.
    if (!data.dryRun && !hasPermission(user, PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT)) {
        return NextResponse.json({ error: "You do not have permission to convert opening balances." }, { status: 403 });
    }

    const date = data.date ?? defaultOpeningDateIso();
    const ref = data.ref?.trim() || DEFAULT_OPENING_REF;

    try {
        const [debtors, creditors] = await Promise.all([
            accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS),
            accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_CREDITORS),
        ]);
        const partyIds = [...new Set([...debtors, ...creditors])];

        const candidates = await prisma.account.findMany({
            where: {
                id:                 { in: partyIds },
                openingBalance:     { not: null },
                openingBalanceType: { not: null },
            },
            select: { id: true, name: true, openingBalance: true, openingBalanceType: true },
            orderBy: { name: "asc" },
        });
        // An account that already has bill-wise openings is left alone. It should
        // not be possible to have both — converting nulls the scalar — but
        // flattening someone's hand-made breakup back into a single bill is not a
        // risk worth taking across a whole book at once. `pnpm opening:to-bills`
        // skips on the same rule.
        const alreadyBillWise = new Set(
            (await prisma.universalVoucher.findMany({
                where:    { type: OPENING_TYPE, partyAccountId: { in: partyIds }, status: { not: "CANCELLED" } },
                select:   { partyAccountId: true },
                distinct: ["partyAccountId"],
            })).map((v) => v.partyAccountId).filter((x): x is number => x !== null),
        );
        const work = candidates.filter((a) => Number(a.openingBalance) !== 0 && !alreadyBillWise.has(a.id));
        const skipped = candidates.filter((a) => alreadyBillWise.has(a.id)).length;

        if (data.dryRun) {
            return NextResponse.json({
                dryRun:  true,
                date, ref,
                accounts: work.length,
                skipped,
                total:    work.reduce((s, a) => s + Number(a.openingBalance), 0),
                preview:  work.slice(0, 20).map((a) => ({
                    accountId: a.id, name: a.name,
                    amount: Number(a.openingBalance), type: a.openingBalanceType,
                })),
            });
        }

        // One transaction per account, not one for all of them: a single failure
        // (a party whose opening is already broken up, say) should not undo the
        // eighty that were fine, and the operation is safe to re-run — an account
        // already converted has no scalar left, so it is simply not a candidate.
        const converted: { accountId: number; name: string; created: number }[] = [];
        const failed: { accountId: number; name: string; reason: string }[] = [];

        for (const a of work) {
            try {
                const result = await prisma.$transaction(
                    (tx) => saveOpeningBills(tx, {
                        accountId: a.id,
                        type:      a.openingBalanceType!,
                        userId:    user!.id,
                        bills:     [{ ref, date, amount: Number(a.openingBalance) }],
                    }),
                    { timeout: 30_000, maxWait: 10_000 },
                );
                converted.push({ accountId: a.id, name: a.name, created: result.created.length });
            } catch (e) {
                failed.push({
                    accountId: a.id, name: a.name,
                    reason: e instanceof OpeningBillError ? e.message : "Unexpected error",
                });
            }
        }

        return NextResponse.json({
            dryRun: false, date, ref,
            converted: converted.length,
            skipped,
            failed,
        });
    } catch (e) {
        return handleApiError(e, "Failed to convert opening balances");
    }
}
