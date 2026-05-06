import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { balanceDelta, toNumber } from "@/modules/tally/lib/balance";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/tally/lib/voucherLifecycle";

// POST /api/finance/vouchers/[id]/restore
// Inverse of delete — re-applies GL impact if the voucher was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("finance:voucher:delete");
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        ensureRestorable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                for (const line of voucher.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                }
                if (voucher.journalEntryId) {
                    await tx.journalEntry.update({
                        where: { id: voucher.journalEntryId },
                        data:  { deletedAt: null, deletedById: null, deleteReason: null },
                    });
                }
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  restoreFields(),
            });
        });

        const restored = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to restore voucher" }, { status: 500 });
    }
}
