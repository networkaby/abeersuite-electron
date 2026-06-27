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
// Reverses the cached Account.balance and marks the spine CANCELLED (truth path
// drops it). Phase 5 5E: the spine IS the financial voucher; `id` is the spine id.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.universalVoucher.findUnique({
        where:   { id: Number(id) },
        include: { lines: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind cancel gate (falls back to generic finance:voucher:cancel).
    if (!userCanVoucher(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Spine lines are scalar — resolve normalBalance for the reversal.
    const nbRows = await prisma.account.findMany({
        where:  { id: { in: [...new Set(voucher.lines.map((l) => l.accountId))] } },
        select: { id: true, normalBalance: true },
    });
    const nbById = new Map(nbRows.map((a) => [a.id, a.normalBalance]));

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // Reverse the cached Account.balance (POSTED only — a DRAFT cancel never
            // touched balances). No counter-entry: the CANCELLED flag drops it from
            // the truth path, so a reversing entry would double-reverse.
            if (voucher.status === "POSTED") {
                for (const line of voucher.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: balanceDelta(nb, line.type, toNumber(line.amount)) } } });
                }
            }
            await tx.universalVoucher.update({ where: { id: voucher.id }, data: cancelFields(user!.id, data.reason) });
        }, { timeout: 30_000, maxWait: 10_000 });

        const cancelled = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel voucher");
    }
}
