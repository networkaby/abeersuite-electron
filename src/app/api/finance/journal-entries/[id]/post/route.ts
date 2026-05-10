import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";

// POST /api/finance/journal-entries/[id]/post
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { normalBalance: true } } } },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Cannot post a deleted entry — restore it first" }, { status: 409 });
    }
    if (entry.status !== "DRAFT") {
        return NextResponse.json({ error: `Entry is already ${entry.status}` }, { status: 409 });
    }

    if (!isBalanced(entry.lines)) {
        return NextResponse.json({ error: "Entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Update each account balance atomically
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
            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: { status: "POSTED", postedAt: new Date() },
            });
        });

        const posted = await prisma.journalEntry.findUnique({
            where: { id: Number(id) },
            include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } },
        });
        return NextResponse.json(posted);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to post journal entry" }, { status: 500 });
    }
}
