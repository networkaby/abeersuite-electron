import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const deleteSchema = z.object({
    reason: z.string().trim().min(1, "Delete reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/delete
// Soft delete: hides the entry from normal views and reverses any GL impact.
// Recoverable via restore. (Tally label: "Delete"; for permanent removal use hard-delete.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_JOURNAL_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, deleteSchema);
    if (error) return error;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { status: true, deletedAt: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const nbById = new Map(
        (await prisma.account.findMany({ where: { id: { in: [...new Set(entry.lines.map((l) => l.accountId))] } }, select: { id: true, normalBalance: true } }))
            .map((a) => [a.id, a.normalBalance]),
    );
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Already deleted" }, { status: 409 });
    }
    if (entry.status === "CANCELLED") {
        return NextResponse.json({ error: "Cannot delete a CANCELLED entry — hard-delete instead" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (entry.status === "POSTED") {
                for (const line of entry.lines) {
                    const delta = balanceDelta(nbById.get(line.accountId)!, line.type, toNumber(line.amount));
                    await tx.account.update({
                        where: { id: line.accountId },
                        data: { balance: { decrement: delta } },
                    });
                }
            }

            await setSpineLifecycle(tx, Number(id), {
                deletedAt: new Date(),
                deletedById: user!.id,
                deleteReason: data.reason,
            });
        // Per-line reversal over the Supabase pooler can exceed the default
        // 5s interactive-tx ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        const updated = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to delete journal entry");
    }
}
