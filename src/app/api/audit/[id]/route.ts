import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { releaseSeriesNumber } from "@/modules/accountancy/lib/releaseSeriesNumber";
import { SERIES_KINDS } from "@/modules/inventory/lib/stock";
import type { InvVoucherType } from "@/generated/prisma/client";

// The VoucherSeries a purged snapshot's number came out of, or null when that kind
// is not series-numbered. Inventory kinds route through the SAME map the allocator
// uses (`invNextRef`), so the legacy prefix kinds — POS_ESTIMATE, POS_ORDER and
// friends, which count their own surviving rows and therefore re-use a freed number
// by themselves — are excluded by construction. A GL voucher type IS its series kind.
function seriesKindOf(entityType: string, subtype: string | null): string | null {
    // Legacy JOURNAL_ENTRY rows carry no subtype — the entity type WAS the kind back
    // then, and every one of them is a journal voucher.
    if (!subtype) return entityType === "JOURNAL_ENTRY" ? "JOURNAL" : null;
    if (entityType === "INV_VOUCHER") return SERIES_KINDS[subtype as InvVoucherType] ?? null;
    return subtype;
}

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
// Because nothing can claim the number back after this, the voucher's reference is
// handed to `releaseSeriesNumber`: if it was the LAST number issued on its series
// and counter, that counter steps back one so the next fresh voucher re-uses it and
// the book carries no gap. Mid-run numbers are left exactly where they are.
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
        // Destroying the snapshot and releasing the number are ONE act: while the
        // snapshot lives, a restore may re-claim that number, so the release may only
        // ever happen inside the same transaction that makes restore impossible.
        const releasedRef = await prisma.$transaction(async (tx) => {
            await tx.auditLog.delete({ where: { id: auditId } });
            return releaseSeriesNumber(tx, seriesKindOf(audit.entityType, audit.subtype), audit.originalRef);
        });
        // Deliberately NOT written back to AuditLog — logging the destruction of an
        // AuditLog row into AuditLog is circular. The server log is the trail.
        console.warn(
            `[recycle-bin] PERMANENT DELETE of AuditLog ${audit.id} (${audit.entityType}` +
            `${audit.subtype ? `/${audit.subtype}` : ""} ${audit.originalRef}) by user ${user!.id}` +
            `${releasedRef ? ` — series number ${releasedRef} released for re-use` : ""}`,
        );
        return NextResponse.json({ ok: true, id: audit.id, reference: audit.originalRef, releasedRef });
    } catch (e) {
        return handleApiError(e, "Failed to delete audit entry");
    }
}
