import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanRestoreAudit } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

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
                createdAt: true, restoredAt: true,
                actor: { select: { id: true, name: true } },
                restoredBy: { select: { id: true, name: true } },
            },
        });
        // Per-ROW gate — the key depends on the removed voucher's kind (subtype),
        // which isn't queryable as a permission, so filter after the fetch.
        return NextResponse.json(rows.filter((r) => userCanRestoreAudit(user!, r.entityType, r.subtype)));
    } catch (e) {
        return handleApiError(e, "Failed to list audit entries");
    }
}
