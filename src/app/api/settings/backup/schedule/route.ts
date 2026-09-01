import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { backupConfigUpdateSchema } from "@/shared/lib/schemas/backupSchemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When automatic backups run — the days and hours behind Settings → Backup & Restore.
 *
 * Read once an hour by the GitHub tick through /api/cron/backup-due. Editing here
 * takes effect on the next tick: no commit, no deploy.
 *
 * settings:manage on both verbs — this row decides whether the business has backups.
 */

// GET /api/settings/backup/schedule — singleton; auto-creates row id=1 if missing.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const row = await prisma.backupConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return NextResponse.json(row);
}

// PATCH /api/settings/backup/schedule — change the days, the hours, or the switch.
export async function PATCH(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, backupConfigUpdateSchema);
    if (error) return error;

    try {
        // Sorted and de-duplicated so the stored row reads the way the UI shows it,
        // and so two saves of the same schedule are byte-identical.
        const tidy = (xs: number[] | undefined) => (xs ? [...new Set(xs)].sort((a, b) => a - b) : undefined);
        const patch = { ...data, weekdays: tidy(data.weekdays), hours: tidy(data.hours) };

        const row = await prisma.backupConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...patch },
            update: patch,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update the backup schedule");
    }
}
