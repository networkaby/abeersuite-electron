import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { nextRefFromSeries, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelInvoiceFields, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const cancelSchema = z.object({ reason: z.string().trim().min(1) });

// POST /api/accountancy/invoices/[id]/cancel
// Tally-style: writes a reversing JE (counter-entry) and marks the invoice as VOID.
// Reference number preserved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_INVOICE_CANCEL);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, cancelSchema);
    if (error) return error;

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        ensureCancelable(invoice);

        await prisma.$transaction(async (tx) => {
            const relatedJes = await tx.journalEntry.findMany({
                where: { status: "POSTED", description: { contains: invoice.number } },
                include: { lines: { include: { account: { select: { normalBalance: true } } } } },
            });

            for (const je of relatedJes) {
                for (const line of je.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                }

                const reversalRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
                const reversalLines = je.lines.map((l) => ({
                    accountId: l.accountId,
                    type: l.type === "DEBIT" ? "CREDIT" : "DEBIT" as "DEBIT" | "CREDIT",
                    amount: l.amount,
                    description: `Cancel reversal — Invoice ${invoice.number}`,
                }));

                const reversalJe = await tx.journalEntry.create({
                    data: {
                        date: new Date(),
                        reference: reversalRef,
                        description: `CANCEL reversal of Invoice ${invoice.number}: ${data.reason}`,
                        status: "POSTED",
                        postedAt: new Date(),
                        createdById: user!.id,
                        lines: { create: reversalLines },
                    },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });

                for (const line of reversalJe.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                }

                await tx.journalEntry.update({
                    where: { id: je.id },
                    data: {
                        status: "CANCELLED",
                        cancelledAt: new Date(),
                        cancelReason: data.reason,
                        cancelledById: user!.id,
                    },
                });
            }

            await tx.invoice.update({
                where: { id: Number(id) },
                // Invoices keep their VOID enum value; the cancel-tier metadata uses the unified fields.
                data: cancelInvoiceFields(user!.id, data.reason),
            });
        });

        const cancelled = await prisma.invoice.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel invoice");
    }
}
