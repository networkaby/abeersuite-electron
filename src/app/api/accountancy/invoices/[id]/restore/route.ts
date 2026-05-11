import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/accountancy/invoices/[id]/restore
// Inverse of delete — re-applies GL impact if the invoice was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.FINANCE_INVOICE_DELETE);
    if (response) return response;

    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        ensureRestorable(invoice);

        await prisma.$transaction(async (tx) => {
            if (isPosted(invoice)) {
                const relatedJes = await tx.journalEntry.findMany({
                    where: {
                        deletedAt: { not: null },
                        description: { contains: invoice.number },
                    },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });
                for (const je of relatedJes) {
                    for (const line of je.lines) {
                        const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                    }
                    await tx.journalEntry.update({
                        where: { id: je.id },
                        data: { deletedAt: null, deletedById: null, deleteReason: null },
                    });
                }
            }

            await tx.invoice.update({
                where: { id: Number(id) },
                data: restoreFields(),
            });
        });

        const restored = await prisma.invoice.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to restore invoice");
    }
}
