import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { restoreFromAudit } from "@/modules/accountancy/lib/auditRestore";
import { liveAuditCopyIds } from "@/modules/accountancy/lib/auditCopyLive";

// POST /api/audit/[id]/restore
// Faithfully rebuild a hard-deleted entity from its AuditLog snapshot (the recycle bin).
// Re-inserts the whole graph with fresh ids but the original reference, re-applies the
// caches when the entity was live, and stamps restoredAt so it can't be restored twice.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const auditId = Number(id);
    if (!Number.isInteger(auditId) || auditId < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const audit = await prisma.auditLog.findUnique({ where: { id: auditId } });
    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (audit.restoredAt) return NextResponse.json({ error: "Already restored" }, { status: 409 });

    // Restore rides the same per-kind DELETE key that authorised the removal —
    // whoever could delete this voucher kind may put it back.
    const { response, user } = await requireAuth();
    if (response) return response;
    if (!userCanRestoreAudit(user!, audit.entityType, audit.subtype)) {
        return NextResponse.json({ error: "You do not have permission to restore this voucher kind." }, { status: 403 });
    }

    try {
        const reference = await prisma.$transaction(async (tx) => {
            // A copy of a voucher that is still on the books never restores: it would
            // add the same bill a second time (see auditCopyLive.ts).
            if ((await liveAuditCopyIds(tx, [audit])).size > 0) return null;
            const ref = await restoreFromAudit(tx, audit);
            await tx.auditLog.update({
                where: { id: auditId },
                data: { restoredAt: new Date(), restoredById: user!.id },
            });
            return ref;
        // Re-inserting the full graph + re-applying caches over the Supabase pooler can
        // exceed the default 5s interactive-tx ceiling (P2028) — match the 30s headroom.
        }, { timeout: 30_000, maxWait: 10_000 });

        if (reference === null) {
            return NextResponse.json({
                error: `${audit.originalRef || "This voucher"} is still on the books, so restoring this copy would save it twice. Edit the voucher itself instead.`,
            }, { status: 409 });
        }
        return NextResponse.json({ ok: true, entityType: audit.entityType, reference });
    } catch (e) {
        return handleApiError(e, "Failed to restore from audit");
    }
}
