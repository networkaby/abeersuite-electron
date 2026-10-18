import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { restoreFromAudit } from "@/modules/accountancy/lib/auditRestore";
import { liveAuditCopyTarget } from "@/modules/accountancy/lib/auditCopyLive";
import { glPatchBodyFromSnapshot, invPatchBodyFromSnapshot } from "@/modules/accountancy/lib/auditRevert";
import { PATCH as patchInvVoucher } from "@/app/api/inventory/vouchers/[id]/route";
import { PATCH as patchGlVoucher } from "@/app/api/accountancy/vouchers/[id]/route";

// POST /api/audit/[id]/restore
// Faithfully rebuild a hard-deleted entity from its AuditLog snapshot (the recycle bin).
// Re-inserts the whole graph with fresh ids but the original reference, re-applies the
// caches when the entity was live, and stamps restoredAt so it can't be restored twice.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    // The voucher is still on the books: change it back to this copy through its own
    // edit save — same id, same number — instead of re-inserting it as a second
    // voucher (how POS-910861/862 became one bill saved twice). See auditRevert.ts.
    const target = await liveAuditCopyTarget(prisma, audit);
    if (target != null) {
        if (audit.entityType === "JOURNAL_ENTRY") {
            return NextResponse.json({ error: `${audit.originalRef || "This voucher"} is still on the books. Edit it there instead.` }, { status: 409 });
        }
        try {
            const snap = audit.snapshot as Record<string, unknown>;
            const isInv = audit.entityType === "INV_VOUCHER";
            const body = isInv ? invPatchBodyFromSnapshot(snap) : glPatchBodyFromSnapshot(snap);
            const editReq = new Request(req.url, {
                method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
            });
            const ctx = { params: Promise.resolve({ id: String(target) }) };
            const res = isInv ? await patchInvVoucher(editReq, ctx) : await patchGlVoucher(editReq, ctx);
            if (!res.ok) return res;
            await prisma.auditLog.update({
                where: { id: auditId },
                data:  { restoredAt: new Date(), restoredById: user!.id },
            });
            return NextResponse.json({ ok: true, entityType: audit.entityType, reference: audit.originalRef, reverted: true });
        } catch (e) {
            return handleApiError(e, "Failed to revert to this copy");
        }
    }

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
