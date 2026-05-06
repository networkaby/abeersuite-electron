import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { balanceDelta, toNumber, nextRef } from "@/modules/tally/lib/balance";
import { z } from "zod";

const cancelSchema = z.object({
    reason: z.string().trim().min(1, "Cancel reason is required"),
});

// POST /api/finance/journal-entries/[id]/cancel
// Tally-style: reverses GL impact via a counter-entry. Original keeps its
// reference number and stays visible (struck through) for audit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:journal:cancel");
    if (response) return response;

    const { id } = await params;
    const parsed = cancelSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

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

            const reversalRef = await nextRef(tx, "journalEntry", "JE");
            await tx.journalEntry.create({
                data: {
                    date: new Date(),
                    reference: reversalRef,
                    description: `REVERSAL of ${entry.reference}: ${parsed.data.reason}`,
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
                    cancelReason: parsed.data.reason,
                    cancelledById: user!.id,
                },
            });
        });

        const cancelled = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to cancel journal entry" }, { status: 500 });
    }
}
