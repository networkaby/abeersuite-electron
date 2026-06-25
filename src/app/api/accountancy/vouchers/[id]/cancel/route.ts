import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelFields, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const schema = z.object({ reason: z.string().trim().min(1, "Cancel reason required") });

// POST /api/accountancy/vouchers/[id]/cancel
// Tally-style: writes a counter-JE and marks the voucher CANCELLED. Reference number preserved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind cancel gate (falls back to generic finance:voucher:cancel).
    if (!userCanVoucher(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // Reverse the cached Account.balance. No counter-entry: the truth path
            // (Balance Sheet / ledgers) drops the voucher automatically once its JE
            // is marked CANCELLED, so a reversing entry would double-reverse. An
            // old/locked-period reversal is the accountant's manual office JV.
            for (const line of voucher.lines) {
                const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
            }

            // Mark the mirror JE CANCELLED → excluded from every POSTED-only aggregation.
            if (voucher.journalEntryId) {
                await tx.journalEntry.update({
                    where: { id: voucher.journalEntryId },
                    data:  {
                        status:        "CANCELLED",
                        cancelledAt:   new Date(),
                        cancelledById: user!.id,
                        cancelReason:  `Voucher ${voucher.reference} cancelled: ${data.reason}`,
                    },
                });
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  cancelFields(user!.id, data.reason),
            });
        // Per-line balance reversal over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) — match 30s.
        }, { timeout: 30_000, maxWait: 10_000 });

        const cancelled = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel voucher");
    }
}
