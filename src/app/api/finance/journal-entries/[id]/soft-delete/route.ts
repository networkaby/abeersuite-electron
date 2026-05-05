import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { balanceDelta, toNumber } from "@/modules/tally/lib/balance";
import { z } from "zod";

const softDeleteSchema = z.object({
    reason: z.string().trim().min(1, "Delete reason is required"),
});

// POST /api/finance/journal-entries/[id]/soft-delete
// Hides the entry from normal views and reverses any GL impact. Recoverable via restore.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:journal:soft-delete");
    if (response) return response;

    const { id } = await params;
    const parsed = softDeleteSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Already deleted" }, { status: 409 });
    }
    if (entry.status === "VOIDED") {
        // VOIDED entries already have a reversal entry; soft-deleting them would double-reverse.
        return NextResponse.json({ error: "Cannot soft-delete a VOIDED entry — hard-delete instead" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Reverse the live Account.balance impact only for POSTED entries.
            // DRAFT entries never affected balances, so nothing to reverse.
            if (entry.status === "POSTED") {
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
            }

            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: {
                    deletedAt: new Date(),
                    deletedById: user!.id,
                    deleteReason: parsed.data.reason,
                },
            });
        });

        const updated = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to soft-delete journal entry" }, { status: 500 });
    }
}
