import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { handleApiError } from "@/shared/lib/api";

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
    } catch (e) {
        return handleApiError(e, "Failed to restore journal entry");
    }
}
