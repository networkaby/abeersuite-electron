import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { balanceDelta, toNumber } from "@/modules/tally/lib/balance";
import { z } from "zod";

const hardDeleteSchema = z.object({
    reason: z.string().trim().min(1, "Delete reason is required"),
});

// POST /api/finance/journal-entries/[id]/hard-delete
// Physically removes the entry. Snapshots row + lines into JournalEntryAudit
// in the same transaction so the deletion is traceable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:journal:hard-delete");
    if (response) return response;

    const { id } = await params;
    const parsed = hardDeleteSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            lines: {
                include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
            },
            createdBy: { select: { id: true, name: true } },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Live balance is currently affected only by entries that are POSTED and not deleted.
    // cancel() reverses + writes a counter-entry; delete() reverses without a counter-entry.
    const needsLedgerReversal = entry.status === "POSTED" && !entry.deletedAt;

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsLedgerReversal) {
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

            const created = await tx.journalEntryAudit.create({
                data: {
                    originalId: entry.id,
                    originalRef: entry.reference,
                    action: "HARD_DELETED",
                    reason: parsed.data.reason,
                    snapshot: entry as unknown as object,
                    actorId: user!.id,
                },
            });

            // Cascade deletes JournalLine via FK onDelete: Cascade
            await tx.journalEntry.delete({ where: { id: entry.id } });

            return created;
        });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsLedgerReversal });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to hard-delete journal entry" }, { status: 500 });
    }
}
