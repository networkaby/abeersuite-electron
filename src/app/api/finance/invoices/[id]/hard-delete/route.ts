import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { auditSnapshot, isPosted, isDeleted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const hardDeleteSchema = z.object({ reason: z.string().trim().min(1, "Delete reason is required") });

// POST /api/finance/invoices/[id]/hard-delete
// Physically removes the invoice. Snapshot to InvoiceAudit for traceability.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_INVOICE_HARD_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, hardDeleteSchema);
    if (error) return error;

    const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
        include: { lines: true, payments: true, createdBy: { select: { id: true, name: true } } },
    });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Live ledger impact only if invoice is currently posted and not soft-deleted/cancelled.
    const needsLedgerReversal = isPosted(invoice) && !isDeleted(invoice) && !isCancelled(invoice);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsLedgerReversal) {
                const relatedJes = await tx.journalEntry.findMany({
                    where: { status: "POSTED", description: { contains: invoice.number }, deletedAt: null },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });
                for (const je of relatedJes) {
                    for (const line of je.lines) {
                        const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                    }
                }
            }

            const created = await tx.invoiceAudit.create({
                data: auditSnapshot({
                    originalId: invoice.id,
                    originalRef: invoice.number,
                    reason: data.reason,
                    snapshot: invoice,
                    actorId: user!.id,
                }),
            });

            // Cascade deletes InvoiceLine + Payment via FK.
            await tx.invoice.delete({ where: { id: invoice.id } });
            return created;
        });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsLedgerReversal });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to hard-delete invoice");
    }
}
