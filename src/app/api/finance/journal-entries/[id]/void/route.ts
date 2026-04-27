import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { balanceDelta, toNumber, nextRef } from "@/modules/tally/lib/balance";
import { z } from "zod";

const voidSchema = z.object({
    reason: z.string().trim().min(1, "Void reason is required"),
});

// POST /api/finance/journal-entries/[id]/void
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const parsed = voidSchema.safeParse(await req.json());
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
    if (entry.status !== "POSTED") {
        return NextResponse.json({ error: "Only POSTED entries can be voided" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Reverse each account balance
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

            // Create reversal journal entry for audit trail
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

            // Re-apply reversed entry balance changes
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
                data: { status: "VOIDED", voidedAt: new Date(), voidReason: parsed.data.reason },
            });
        });

        const voided = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(voided);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to void journal entry" }, { status: 500 });
    }
}
