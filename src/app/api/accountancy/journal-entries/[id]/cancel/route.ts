import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const cancelSchema = z.object({
    reason: z.string().trim().min(1, "Cancel reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/cancel
// Tally-style: reverses GL impact via a counter-entry. Original keeps its
// reference number and stays visible (struck through) for audit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_JOURNAL_CANCEL);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, cancelSchema);
    if (error) return error;

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { normalBalance: true } } } },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Cannot cancel a deleted entry — restore it first" }, { status: 409 });
    }
    if (entry.status !== "POSTED") {
        return NextResponse.json({ error: "Only POSTED entries can be cancelled" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            for (const line of entry.lines) {
                const delta = balanceDelta(
                    line.account.normalBalance!,
                    line.type,
                    toNumber(line.amount),
                );
                await tx.account.update({
                    where: { id: line.accountId },
                    data: { balance: { decrement: delta } },
                });
            }

            const reversalRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
            await tx.journalEntry.create({
                data: {
                    date: new Date(),
                    reference: reversalRef,
                    description: `REVERSAL of ${entry.reference}: ${data.reason}`,
                    status: "POSTED",
                    postedAt: new Date(),
                    createdById: user!.id,
                    lines: {
                        create: entry.lines.map((l) => ({
                            accountId: l.accountId,
                            type: l.type === "DEBIT" ? "CREDIT" : "DEBIT",
                            amount: l.amount,
                            description: `Reversal of ${entry.reference}`,
                        })),
                    },
                },
            });

            for (const line of entry.lines) {
                const reversedType = line.type === "DEBIT" ? "CREDIT" : "DEBIT";
                const delta = balanceDelta(
                    line.account.normalBalance!,
                    reversedType,
                    toNumber(line.amount),
                );
                await tx.account.update({
                    where: { id: line.accountId },
                    data: { balance: { increment: delta } },
                });
            }

            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancelReason: data.reason,
                    cancelledById: user!.id,
                },
            });
        });

        const cancelled = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        return handleApiError(e, "Failed to cancel journal entry");
    }
}
