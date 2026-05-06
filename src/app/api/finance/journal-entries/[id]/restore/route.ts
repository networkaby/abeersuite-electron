import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { balanceDelta, toNumber } from "@/modules/tally/lib/balance";

// POST /api/finance/journal-entries/[id]/restore
// Inverse of soft-delete. Re-applies GL impact if the entry was POSTED.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("finance:journal:delete");
    if (response) return response;

    const { id } = await params;

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!entry.deletedAt) {
        return NextResponse.json({ error: "Entry is not deleted" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (entry.status === "POSTED") {
                for (const line of entry.lines) {
                    const delta = balanceDelta(
                        line.account.normalBalance!,
                        line.type,
                        toNumber(line.amount),
                    );
                    await tx.account.update({
                        where: { id: line.accountId },
                        data: { balance: { increment: delta } },
                    });
                }
            }

            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: {
                    deletedAt: null,
                    deletedById: null,
                    deleteReason: null,
                },
            });
        });

        const restored = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to restore journal entry" }, { status: 500 });
    }
}
