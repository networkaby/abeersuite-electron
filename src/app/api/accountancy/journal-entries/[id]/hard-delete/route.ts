import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const hardDeleteSchema = z.object({
    reason: z.string().trim().min(1, "Delete reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/hard-delete
// Physically removes the entry. Snapshots row + lines into AuditLog (JOURNAL_ENTRY)
// in the same transaction so the deletion is traceable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ADMIN_BYPASS);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, hardDeleteSchema);
    if (error) return error;

    const entry = await prisma.universalVoucher.findUnique({
        where:   { id: Number(id) },
        include: { lines: { select: { accountId: true, type: true, amount: true, description: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Live balance is currently affected only by entries that are POSTED and not deleted.
    // cancel() reverses + writes a counter-entry; delete() reverses without a counter-entry.
    const needsLedgerReversal = entry.status === "POSTED" && !entry.deletedAt;

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsLedgerReversal) {
                // Nature resolves with the group fallback, exactly as the engine
                // resolved it when posting — a party ledger carries a null
                // normalBalance, and a bare read used to sign-flip its delta.
                await applyLineBalances(tx, entry.lines, "reverse");
                // Removing a posted entry dirties a reconciled window exactly as
                // much as adding one — same retreat as the posting path.
                await retreatReconciliation(tx, entry.lines.map((l) => l.accountId), entry.date);
            }

            const created = await tx.auditLog.create({
                data: {
                    entityType: "JOURNAL_ENTRY",
                    originalId: entry.id,
                    originalRef: entry.voucherNo ?? formatUvNo(entry.id),
                    action: "HARD_DELETED",
                    reason: data.reason,
                    snapshot: entry as unknown as object,
                    actorId: user!.id,
                },
            });

            // Cascade deletes VoucherGlLine via FK onDelete: Cascade
            await tx.universalVoucher.delete({ where: { id: entry.id } });

            return created;
        // Per-line reversal over the Supabase pooler can exceed the default
        // 5s interactive-tx ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsLedgerReversal });
    } catch (e) {
        return handleApiError(e, "Failed to hard-delete journal entry");
    }
}
