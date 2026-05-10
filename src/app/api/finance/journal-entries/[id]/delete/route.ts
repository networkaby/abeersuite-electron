import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { z } from "zod";

const deleteSchema = z.object({
    reason: z.string().trim().min(1, "Delete reason is required"),
});

// POST /api/finance/journal-entries/[id]/delete
// Soft delete: hides the entry from normal views and reverses any GL impact.
// Recoverable via restore. (Tally label: "Delete"; for permanent removal use hard-delete.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:journal:delete");
    if (response) return response;

    const { id } = await params;
    const parsed = deleteSchema.safeParse(await req.json());
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
    if (entry.status === "CANCELLED") {
        return NextResponse.json({ error: "Cannot delete a CANCELLED entry — hard-delete instead" }, { status: 409 });
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
        return NextResponse.json({ error: "Failed to delete journal entry" }, { status: 500 });
    }
}
