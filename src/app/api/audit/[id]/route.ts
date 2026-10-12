import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { releaseSeriesNumber, seriesKindOf } from "@/modules/accountancy/lib/releaseSeriesNumber";
import { auditSnapshotKind } from "@/shared/lib/accountancy/auditSnapshotKind";

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
        // The copy holds bare product / account ids. Resolve them to today's names
        // in two batched lookups so the viewer reads like a voucher, not a dump.
        const snap = (audit.snapshot ?? {}) as {
            lines?: { productId?: number; accountId?: number }[];
            journalEntry?: { lines?: { accountId?: number }[] } | null;
            partyAccountId?: number | null;
        };
        const productIds = new Set<number>();
        const accountIds = new Set<number>();
        for (const l of snap.lines ?? []) {
            if (typeof l.productId === "number") productIds.add(l.productId);
            if (typeof l.accountId === "number") accountIds.add(l.accountId);
        }
        for (const l of snap.journalEntry?.lines ?? []) {
            if (typeof l.accountId === "number") accountIds.add(l.accountId);
        }
        if (typeof snap.partyAccountId === "number") accountIds.add(snap.partyAccountId);
        const [products, accounts] = await Promise.all([
            productIds.size ? prisma.invProduct.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true } }) : [],
            accountIds.size ? prisma.account.findMany({ where: { id: { in: [...accountIds] } }, select: { id: true, name: true } }) : [],
        ]);
        return NextResponse.json({
            ...audit,
            names: {
                products: Object.fromEntries(products.map((p) => [p.id, p.name])),
                accounts: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to read audit entry");
    }
}

// DELETE /api/audit/[id]
// Permanently destroy a recycle-bin snapshot. The end of the line — nothing else in
// the app deletes AuditLog — and HOW FAR it reaches depends on which kind of copy
// the row is (`auditSnapshotKind`), which is the owner's rule from 2026-09-20:
//
//   EDIT copy   — the pre-edit picture of a voucher that is still alive. Only that
//                 one row goes: all you lose is the ability to go back to that older
//                 version. The voucher, its number and its other copies are untouched.
//   DELETE copy — the voucher's last surviving copy. "Delete permanently should
//                 delete the voucher completely", so this takes EVERY copy of that
//                 voucher with it, edit copies included. Nothing of it is left.
//
// Only then can the number be free, so `releaseSeriesNumber` runs on the same act:
// if it was the LAST number issued on its series and counter, that counter steps
// back one and the next fresh voucher re-uses it, leaving no gap in the book.
// Mid-run numbers are left exactly where they are.
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
        select: { id: true, entityType: true, subtype: true, originalRef: true, action: true, reason: true, originalId: true },
    });
    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const kind = auditSnapshotKind(audit);

    try {
        // Destroying the copies and releasing the number are ONE act: while any copy
        // survives, a restore may re-claim that number, so the release may only ever
        // happen inside the same transaction that makes restore impossible.
        const { releasedRef, removed } = await prisma.$transaction(async (tx) => {
            let removed = 1;
            if (kind === "DELETE") {
                // Every copy of the SAME voucher, identified the way the writers key
                // it — entity type + the original row id, which both the edit routes
                // and the hard-delete routes stamp from the voucher's own id. The
                // reference is not the identity: a draft carries a placeholder one,
                // and two kinds could in principle print alike.
                const wiped = await tx.auditLog.deleteMany({
                    where: { entityType: audit.entityType, originalId: audit.originalId },
                });
                removed = wiped.count;
                // A row whose id no longer matches anything (an older snapshot written
                // before originalId was keyed this way) still has to go — it is the row
                // the user clicked.
                if (removed === 0) {
                    await tx.auditLog.delete({ where: { id: auditId } });
                    removed = 1;
                }
            } else {
                await tx.auditLog.delete({ where: { id: auditId } });
            }
            // An edit copy never frees a number: the voucher is alive and still
            // printing it. `releaseSeriesNumber` would refuse anyway; not asking is
            // clearer, and saves the lookups.
            const releasedRef = kind === "DELETE"
                ? await releaseSeriesNumber(tx, seriesKindOf(audit.entityType, audit.subtype), audit.originalRef)
                : null;
            return { releasedRef, removed };
        });
        // Deliberately NOT written back to AuditLog — logging the destruction of an
        // AuditLog row into AuditLog is circular. The server log is the trail.
        console.warn(
            `[recycle-bin] PERMANENT DELETE of AuditLog ${audit.id} (${audit.entityType}` +
            `${audit.subtype ? `/${audit.subtype}` : ""} ${audit.originalRef}) by user ${user!.id}` +
            ` — ${kind === "DELETE" ? "whole voucher" : "pre-edit copy"}, ${removed} snapshot(s) removed` +
            `${releasedRef ? `, series number ${releasedRef} released for re-use` : ""}`,
        );
        return NextResponse.json({ ok: true, id: audit.id, reference: audit.originalRef, releasedRef, kind, removed });
    } catch (e) {
        return handleApiError(e, "Failed to delete audit entry");
    }
}
