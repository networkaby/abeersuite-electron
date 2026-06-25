import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureDeletable, deleteFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason required") });

// POST /api/accountancy/vouchers/[id]/delete
// Soft-delete: hides from views and reverses GL impact (no counter-entry). Recoverable.
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
    // Per-kind delete gate (falls back to generic finance:voucher:delete).
    if (!userCanVoucher(user, voucher.type, "delete")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        ensureDeletable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                for (const line of voucher.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                }
                if (voucher.journalEntryId) {
                    await tx.journalEntry.update({
                        where: { id: voucher.journalEntryId },
                        data:  {
                            deletedAt:    new Date(),
                            deletedById:  user!.id,
                            deleteReason: `Voucher ${voucher.reference} deleted: ${data.reason}`,
                        },
                    });
                }
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  deleteFields(user!.id, data.reason),
            });
        // Per-line balance reversal over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) — match 30s.
        }, { timeout: 30_000, maxWait: 10_000 });

        const updated = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to delete voucher");
    }
}
