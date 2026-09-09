import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/audit/[id]
// One recycle-bin snapshot in full — the removed voucher's header, its lines and
// the GL it carried at the moment it was taken. The list route deliberately
// leaves the snapshot out (it is a whole voucher graph per row); this is how you
// look inside one, to answer "what was in it?" before restoring, and to see what
// an in-place edit replaced. Read-only; rides the same per-kind key as restore.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const auditId = Number(id);
    if (!Number.isInteger(auditId) || auditId < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { response, user } = await requireAuth();
    if (response) return response;

    try {
        const audit = await prisma.auditLog.findUnique({
            where:  { id: auditId },
            select: {
                id: true, entityType: true, subtype: true, originalId: true, originalRef: true,
                action: true, reason: true, snapshot: true, createdAt: true, restoredAt: true,
                actor: { select: { id: true, name: true } },
            },
        });
        if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!userCanRestoreAudit(user!, audit.entityType, audit.subtype)) {
            return NextResponse.json({ error: "You do not have permission to view this voucher kind." }, { status: 403 });
        }
        return NextResponse.json(audit);
    } catch (e) {
        return handleApiError(e, "Failed to read audit entry");
    }
}

// DELETE /api/audit/[id]
// Permanently destroy ONE recycle-bin snapshot. This is the end of the line: the
// AuditLog row IS the only surviving copy of a hard-deleted voucher, so removing
// it makes that voucher unrecoverable. Nothing else in the app deletes AuditLog.
//
// SUPER ADMIN ONLY — `admin:bypass` is a code-only sentinel that is deliberately
// absent from the seed and un-grantable in the Role Matrix; only the env super
// admin (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD) ever holds it. That is a
// deliberately higher bar than RESTORE, which rides the per-kind delete key:
// putting a voucher back is recoverable, erasing its last copy is not.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const auditId = Number(id);
    if (!Number.isInteger(auditId) || auditId < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { response, user } = await requirePermission(PERMISSIONS.ADMIN_BYPASS);
    if (response) return response;

    const audit = await prisma.auditLog.findUnique({
        where:  { id: auditId },
        select: { id: true, entityType: true, subtype: true, originalRef: true },
    });
    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        await prisma.auditLog.delete({ where: { id: auditId } });
        // Deliberately NOT written back to AuditLog — logging the destruction of an
        // AuditLog row into AuditLog is circular. The server log is the trail.
        console.warn(
            `[recycle-bin] PERMANENT DELETE of AuditLog ${audit.id} (${audit.entityType}` +
            `${audit.subtype ? `/${audit.subtype}` : ""} ${audit.originalRef}) by user ${user!.id}`,
        );
        return NextResponse.json({ ok: true, id: audit.id, reference: audit.originalRef });
    } catch (e) {
        return handleApiError(e, "Failed to delete audit entry");
    }
}
