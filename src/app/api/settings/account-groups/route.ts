import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/settings/account-groups — flat list of account groups for settings
// selectors (e.g. the additional-cost pool group). Settings-scoped so a settings
// admin without accountancy:view:org can still choose a group. Read-only.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const groups = await prisma.accountGroup.findMany({
            where: { isActive: true },
            orderBy: [{ type: "asc" }, { name: "asc" }],
            select: { id: true, name: true, type: true },
        });
        return NextResponse.json(groups);
    } catch (e) {
        return handleApiError(e, "Failed to load account groups");
    }
}
