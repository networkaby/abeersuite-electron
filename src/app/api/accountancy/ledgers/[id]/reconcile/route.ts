import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { startOfDayUtc, toDateOnlyUtc, todayIso } from "@/shared/lib/format/formatDate";
import { BankReconError, assertLockAllowed } from "@/modules/accountancy/lib/bankReconciliation";

// POST /api/accountancy/ledgers/[id]/reconcile
//
// Sets (or clears) this ledger's reconciliation watermark — "I matched this
// ledger against its outside statement up to and including this date".
//
// Deliberately NOT folded into the master-edit PATCH: reconciling is a routine
// accounting act performed from the ledger view, not a change to master data,
// and the PATCH schema already carries six `*Json` particulars blocks.
//
// The watermark can be pulled BACK automatically later — a voucher posted (or
// hard-deleted) inside the reconciled window retreats it to the day before that
// entry. See retreatReconciliation() in modules/accountancy/lib/reconciliation.ts.
const schema = z.object({
    /** yyyy-mm-dd — matched up to and including this business date. null clears. */
    reconciledThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd").nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    // You cannot have checked a statement that hasn't happened yet.
    if (data.reconciledThrough && data.reconciledThrough > todayIso()) {
        return NextResponse.json({ error: "Reconciled-through date cannot be in the future" }, { status: 400 });
    }

    const exists = await prisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    // The bank is the truth: a bank ledger's lock may not pass a statement line
    // nobody has matched or booked. Ledgers with no statement on file are
    // unaffected (nothing to be inconsistent with).
    if (data.reconciledThrough) {
        try {
            await assertLockAllowed(id, data.reconciledThrough);
        } catch (e) {
            if (e instanceof BankReconError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }
    }

    try {
        const account = await prisma.account.update({
            where: { id },
            // All three move together: the watermark, the wall-clock instant the
            // human performed the check, and who performed it. Clearing wipes all
            // three — a ledger with no watermark has no reconciliation to attribute.
            data: data.reconciledThrough
                ? {
                    reconciledThrough: startOfDayUtc(data.reconciledThrough),
                    reconciledAt:      new Date(),
                    reconciledById:    user!.id,
                }
                : { reconciledThrough: null, reconciledAt: null, reconciledById: null },
            select: {
                id: true,
                reconciledThrough: true,
                reconciledAt: true,
                reconciledBy: { select: { id: true, name: true } },
            },
        });

        return NextResponse.json({
            ...account,
            // Mirror of the startOfDayUtc write — toDateOnly (local components)
            // would slip a day west of UTC.
            reconciledThrough: account.reconciledThrough ? toDateOnlyUtc(account.reconciledThrough) : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to update reconciliation");
    }
}
