import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Recycle-bin (hard-delete / restore) is an admin-only action across all entity
// types — the per-kind hard-delete permissions were retired (not UI-assignable).
const PERM_BY_TYPE: Record<string, string> = {
    INV_VOUCHER:   PERMISSIONS.ADMIN_BYPASS,
    GL_VOUCHER:    PERMISSIONS.ADMIN_BYPASS,
    JOURNAL_ENTRY: PERMISSIONS.ADMIN_BYPASS,
};

// GET /api/audit?entityType=&includeRestored=1
// The recycle bin — hard-deleted entities (AuditLog snapshots), filtered to the types
// the caller may restore. The first-ever reader of the audit data.
export async function GET(req: Request) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const allowedTypes = Object.entries(PERM_BY_TYPE)
        .filter(([, perm]) => hasPermission(user!, perm))
        .map(([t]) => t);
    if (allowedTypes.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const url = new URL(req.url);
        const entityType = url.searchParams.get("entityType");
        const includeRestored = url.searchParams.get("includeRestored") === "1";
        const typeFilter = entityType && allowedTypes.includes(entityType) ? [entityType] : allowedTypes;

        const rows = await prisma.auditLog.findMany({
            where: {
                entityType: { in: typeFilter },
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
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to list audit entries");
    }
}
