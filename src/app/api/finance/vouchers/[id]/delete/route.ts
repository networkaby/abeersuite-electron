import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureDeletable, deleteFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason required") });

// POST /api/finance/vouchers/[id]/delete
// Soft-delete: hides from views and reverses GL impact (no counter-entry). Recoverable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:voucher:delete");
    if (response) return response;

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Reason required" }, { status: 400 });

    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
                            deleteReason: `Voucher ${voucher.reference} deleted: ${parsed.data.reason}`,
                        },
                    });
                }
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  deleteFields(user!.id, parsed.data.reason),
            });
        });

        const updated = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to delete voucher" }, { status: 500 });
    }
}
