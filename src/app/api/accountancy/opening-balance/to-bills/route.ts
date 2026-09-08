import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    saveOpeningBills, defaultOpeningDateIso, DEFAULT_OPENING_REF, OpeningBillError,
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
// it first: this moves `Account.balance`, which is what the POS credit check
// reads — `pnpm opening:preview` shows that effect in full.
const schema = z.object({
    dryRun: z.boolean().default(true),
    /** Date every created bill carries. Defaults to the start of this financial year. */
    date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
    /** Bill number for the single bill. Defaults to "Opening Balance". */
    ref:    z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

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
        const work = candidates.filter((a) => Number(a.openingBalance) !== 0);

        if (data.dryRun) {
            return NextResponse.json({
                dryRun:  true,
                date, ref,
                accounts: work.length,
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
            failed,
        });
    } catch (e) {
        return handleApiError(e, "Failed to convert opening balances");
    }
}
