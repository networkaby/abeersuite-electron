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
// Soft-delete: hides from views and reverses the GL impact (POSTED only).
// Phase 5 5E: the spine IS the financial voucher; `id` is the spine id.
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
    if (!userCanVoucher(user, voucher.type, "delete")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nbRows = await prisma.account.findMany({
        where:  { id: { in: [...new Set(voucher.lines.map((l) => l.accountId))] } },
        select: { id: true, normalBalance: true },
    });
    const nbById = new Map(nbRows.map((a) => [a.id, a.normalBalance]));

    try {
        ensureDeletable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                for (const line of voucher.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: balanceDelta(nb, line.type, toNumber(line.amount)) } } });
                }
            }
            await tx.universalVoucher.update({ where: { id: voucher.id }, data: deleteFields(user!.id, data.reason) });
        }, { timeout: 30_000, maxWait: 10_000 });

        const updated = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to delete voucher");
    }
}
