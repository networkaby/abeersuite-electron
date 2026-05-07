import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureDeletable, deleteFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";

const deleteSchema = z.object({ reason: z.string().trim().min(1, "Delete reason is required") });

// POST /api/finance/invoices/[id]/delete
// Soft-delete — hides from views and reverses GL impact for posted invoices. Recoverable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:invoice:delete");
    if (response) return response;

    const { id } = await params;
    const parsed = deleteSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Reason required" }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        ensureDeletable(invoice);

        await prisma.$transaction(async (tx) => {
            // For posted invoices, reverse the matching journal entries (mirrors cancel flow but
            // without writing a counter-entry — the entries are simply marked deleted).
            if (isPosted(invoice)) {
                const relatedJes = await tx.journalEntry.findMany({
                    where: {
                        status: "POSTED",
                        description: { contains: invoice.number },
                        deletedAt: null,
                    },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });
                for (const je of relatedJes) {
                    for (const line of je.lines) {
                        const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                    }
                    await tx.journalEntry.update({
                        where: { id: je.id },
                        data: {
                            deletedAt: new Date(),
                            deletedById: user!.id,
                            deleteReason: `Invoice ${invoice.number} deleted: ${parsed.data.reason}`,
                        },
                    });
                }
            }

            await tx.invoice.update({
                where: { id: Number(id) },
                data: deleteFields(user!.id, parsed.data.reason),
            });
        });

        const updated = await prisma.invoice.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
    }
}
