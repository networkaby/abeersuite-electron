import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission, requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { cancelVoucherInTx } from "@/modules/accountancy/lib/cancelVoucherInTx";

// POST /api/hr/payroll/[id]/cancel — take a posted run back out of the books.
//
// A draft is DELETED (see the DELETE on the parent route); it never reached the
// books, so there is nothing to undo. A POSTED run is CANCELLED instead: the
// journal it created is voided through the same `cancelVoucherInTx` the vouchers
// screen and the POS shift routes use — balances reversed, the voucher kept and
// struck through for audit — and the run is stamped CANCELLED in the same
// transaction, so a run can never say "posted" about a voucher that is not.
//
// Cancelling FREES THE DAYS. `overlappingRun()` ignores cancelled runs, so the
// period can be generated again once the reason for cancelling is fixed. That is
// the whole point of this route: before it existed a wrong run was stuck, still
// claiming its dates, with only the journal cancellable from Accountancy.
//
// Two gates, the same pair as posting: hr:payroll:run, and the ordinary JOURNAL
// cancel gate, because this reverses a general-ledger voucher.

const cancelSchema = z.object({
    reason: z.string().trim().min(1, "Say why the run is being cancelled").max(300),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_PAYROLL_RUN);
    if (response) return response;

    const cancelGate = await requireVoucherPermission("JOURNAL", "cancel");
    if (cancelGate.response) return cancelGate.response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    const { data: body, error } = await validateRequest(req, cancelSchema);
    if (error) return error;

    try {
        const run = await prisma.payrollRun.findUnique({
            where:  { id },
            select: { id: true, status: true, voucherId: true, voucherRef: true },
        });
        if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        if (run.status === "CANCELLED") {
            return NextResponse.json({ error: "This run is already cancelled" }, { status: 409 });
        }
        if (run.status !== "POSTED") {
            return NextResponse.json(
                { error: "Only a posted run is cancelled — delete a draft instead" },
                { status: 422 },
            );
        }

        await prisma.$transaction(async (tx) => {
            // Re-read inside the transaction: two people cancelling at once must
            // not reverse the same balances twice.
            const fresh = await tx.payrollRun.findUnique({ where: { id }, select: { status: true } });
            if (fresh?.status !== "POSTED") throw new Error("ALREADY_CANCELLED");

            if (run.voucherId) {
                // `skipIfCancelled`: someone may have cancelled the journal by
                // hand in Accountancy already, which is exactly the state we
                // want — that must not stop the run being marked to match.
                await cancelVoucherInTx(tx, run.voucherId, caller!.id, body.reason, { skipIfCancelled: true });
            }

            await tx.payrollRun.update({
                where: { id },
                data: {
                    status: "CANCELLED",
                    note:   body.reason,
                },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, voucherRef: run.voucherRef });
    } catch (e) {
        if (e instanceof Error && e.message === "ALREADY_CANCELLED") {
            return NextResponse.json({ error: "This run was cancelled a moment ago by someone else" }, { status: 409 });
        }
        return handleApiError(e, "Failed to cancel the payroll run");
    }
}
