import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

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
    const { data, error } = await validateRequest(req, hardDeleteSchema);
    if (error) return error;

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
                    reason: data.reason,
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
