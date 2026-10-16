import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { releaseSeriesNumber, seriesKindOf } from "@/modules/accountancy/lib/releaseSeriesNumber";
import { liveAuditCopyIds } from "@/modules/accountancy/lib/auditCopyLive";
import { auditSnapshotKind } from "@/shared/lib/accountancy/auditSnapshotKind";

// Recycle-bin visibility follows the DELETE key, per kind: you see what you could
// have deleted (and may therefore restore). It used to demand `admin:bypass`,
// which nobody holds — the bin listed nothing for every user, admin included.

// GET /api/audit?entityType=&includeRestored=1
// The recycle bin — hard-deleted entities (AuditLog snapshots), filtered to the types
// the caller may restore. The first-ever reader of the audit data.
export async function GET(req: Request) {
    const { response, user } = await requireAuth();
    if (response) return response;

    try {
        const url = new URL(req.url);
        const entityType = url.searchParams.get("entityType");
        const includeRestored = url.searchParams.get("includeRestored") === "1";

        const rows = await prisma.auditLog.findMany({
            where: {
                ...(entityType ? { entityType } : {}),
                ...(includeRestored ? {} : { restoredAt: null }),
            },
            orderBy: { createdAt: "desc" },
            take: 200,
            select: {
                id: true, entityType: true, subtype: true, originalRef: true, action: true, reason: true,
                // The voucher a row is a copy OF — the Recycle Bin groups by it, since a
                // permanent delete of the DELETE copy takes the voucher's other copies too.
                originalId: true,
                createdAt: true, restoredAt: true,
                actor: { select: { id: true, name: true } },
                restoredBy: { select: { id: true, name: true } },
            },
        });
        // Per-ROW gate — the key depends on the removed voucher's kind (subtype),
        // which isn't queryable as a permission, so filter after the fetch.
        const visible = rows.filter((r) => userCanRestoreAudit(user!, r.entityType, r.subtype));
        // `voucherLive`: the voucher this is a copy of is still on the books, so the
        // bin offers no Restore for it (the restore route refuses it too).
        const live = await liveAuditCopyIds(prisma, visible.filter((r) => !r.restoredAt));
        return NextResponse.json(visible.map((r) => ({ ...r, voucherLive: live.has(r.id) })));
    } catch (e) {
        return handleApiError(e, "Failed to list audit entries");
    }
}

/** What the caller must type to empty the bin — the button sends it, a stray request cannot. */
const EMPTY_BIN_CONFIRM = "EMPTY";

// DELETE /api/audit   body: { confirm: "EMPTY" }
// Empty the whole recycle bin: every snapshot, deleted-voucher copies and pre-edit
// copies alike, restored ones included. The bulk form of DELETE /api/audit/[id],
// under the same SUPER ADMIN gate, and never undoable.
//
// Numbers are released the same way a single purge releases them — only a number
// at the tip of its series steps back. Releasing one tip can expose the next deleted
// number as the new tip, so the release is repeated until a pass frees nothing:
// three bills deleted off the end of a run give all three numbers back.
export async function DELETE(req: Request) {
    const { response, user } = await requirePermission(PERMISSIONS.ADMIN_BYPASS);
    if (response) return response;

    const body = await req.json().catch(() => null) as { confirm?: unknown } | null;
    if (body?.confirm !== EMPTY_BIN_CONFIRM) {
        return NextResponse.json({ error: `Type ${EMPTY_BIN_CONFIRM} to empty the recycle bin.` }, { status: 400 });
    }

    try {
        const { removed, released } = await prisma.$transaction(async (tx) => {
            const rows = await tx.auditLog.findMany({
                select: { entityType: true, subtype: true, originalRef: true, action: true, reason: true },
            });
            const wiped = await tx.auditLog.deleteMany({});

            // Only a deleted voucher's number can be free; an edit copy's voucher is alive.
            let pending = rows
                .filter((r) => auditSnapshotKind(r) === "DELETE" && r.originalRef)
                .map((r) => ({ kind: seriesKindOf(r.entityType, r.subtype), ref: r.originalRef }));
            const released: string[] = [];
            for (let freed = true; freed && pending.length > 0;) {
                freed = false;
                const still: typeof pending = [];
                for (const p of pending) {
                    const ref = await releaseSeriesNumber(tx, p.kind, p.ref);
                    if (ref) { released.push(ref); freed = true; } else still.push(p);
                }
                pending = still;
            }
            return { removed: wiped.count, released };
        }, { timeout: 60_000 });

        // Not written back to AuditLog, for the same reason as the single purge.
        console.warn(
            `[recycle-bin] EMPTIED by user ${user!.id} — ${removed} snapshot(s) removed` +
            `${released.length ? `, numbers released for re-use: ${released.join(", ")}` : ""}`,
        );
        return NextResponse.json({ ok: true, removed, released });
    } catch (e) {
        return handleApiError(e, "Failed to empty the recycle bin");
    }
}
