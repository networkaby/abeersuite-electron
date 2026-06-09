import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { restoreFromAudit } from "@/modules/accountancy/lib/auditRestore";

// Whoever may hard-delete a given entity type may restore it.
const PERM_BY_TYPE: Record<string, string> = {
    INV_VOUCHER:   PERMISSIONS.INVENTORY_VOUCHER_HARD_DELETE,
    GL_VOUCHER:    PERMISSIONS.FINANCE_VOUCHER_HARD_DELETE,
    JOURNAL_ENTRY: PERMISSIONS.FINANCE_JOURNAL_HARD_DELETE,
};

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

    const perm = PERM_BY_TYPE[audit.entityType];
    if (!perm) return NextResponse.json({ error: `Cannot restore entity type ${audit.entityType}` }, { status: 400 });

    const { response, user } = await requirePermission(perm);
    if (response) return response;

    try {
        const reference = await prisma.$transaction(async (tx) => {
            const ref = await restoreFromAudit(tx, audit);
            await tx.auditLog.update({
                where: { id: auditId },
                data: { restoredAt: new Date(), restoredById: user!.id },
            });
            return ref;
        // Re-inserting the full graph + re-applying caches over the Supabase pooler can
        // exceed the default 5s interactive-tx ceiling (P2028) — match the 30s headroom.
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, entityType: audit.entityType, reference });
    } catch (e) {
        return handleApiError(e, "Failed to restore from audit");
    }
}
