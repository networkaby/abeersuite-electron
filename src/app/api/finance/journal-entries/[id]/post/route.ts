import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { isBalanced, balanceDelta, toNumber } from "@/lib/finance/balance";

// POST /api/finance/journal-entries/[id]/post
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { glAccount: { select: { normalBalance: true } } } },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.status !== "DRAFT") {
        return NextResponse.json({ error: `Entry is already ${entry.status}` }, { status: 409 });
    }

    if (!isBalanced(entry.lines)) {
        return NextResponse.json({ error: "Entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Update each GL account balance atomically
            for (const line of entry.lines) {
                const delta = balanceDelta(
                    line.glAccount.normalBalance,
                    line.type,
                    toNumber(line.amount),
                );
                await tx.glAccount.update({
                    where: { id: line.glAccountId },
                    data: { balance: { increment: delta } },
                });
            }
            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: { status: "POSTED", postedAt: new Date() },
            });
        });

        const posted = await prisma.journalEntry.findUnique({
            where: { id: Number(id) },
            include: { lines: { include: { glAccount: { select: { id: true, code: true, name: true } } } } },
        });
        return NextResponse.json(posted);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to post journal entry" }, { status: 500 });
    }
}
