import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { backupConfigUpdateSchema } from "@/shared/lib/schemas/backupSchemas";

export const runtime = "nodejs";

/**
 * The scheduled-backup settings behind Settings → Backup & Restore.
 *
 * NOT LIVE YET. /api/cron/backup ignores this row and still dispatches on every
 * tick — reading or writing here changes nothing until the activation checklist in
 * docs/backup-schedule-activation.md is done.
 *
 * settings:manage on both verbs, not just read-for-any-user: the row says when this
 * database gets copied out to Dropbox, which is the same class of secret as the
 * backup button next to it.
 */

// GET /api/settings/backup/schedule — singleton; auto-creates row id=1 if missing.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const row = await prisma.backupConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return NextResponse.json(row);
}

// PATCH /api/settings/backup/schedule — toggle scheduling, or change when it runs.
export async function PATCH(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, backupConfigUpdateSchema);
    if (error) return error;

    try {
        // Switching back to daily clears the weekday, so a stale value cannot sit in
        // the row and reappear the next time someone picks weekly.
        const patch = data.frequency === "daily" ? { ...data, weekday: null } : data;
        const row = await prisma.backupConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...patch },
            update: patch,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update backup schedule");
    }
}
