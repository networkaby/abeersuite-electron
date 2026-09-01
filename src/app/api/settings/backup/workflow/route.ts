import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { backupAvailability, COUNTER_ONLY_MESSAGE } from "@/shared/lib/backup/availability";
import { getScheduledBackupState, setScheduledBackupEnabled } from "@/shared/lib/backup/githubDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The automatic-backup switch on Settings → Backup & Restore.
 *
 * It flips GitHub's own enable/disable state for backup-scheduled.yml, which takes
 * effect immediately — no commit, no deploy, no database row. The timetable itself
 * still lives in that file (see README → Backup Schedule); this only decides
 * whether it is allowed to fire.
 *
 * Consequence worth knowing: the off state lives in GitHub, not in the repo, so
 * backup-scheduled.yml keeps listing its cron times while switched off. The UI is
 * where that truth is shown.
 *
 * settings:manage on both verbs — this decides whether the business has backups.
 */

// GET /api/settings/backup/workflow — is the schedule running?
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    // A counter build ships without the GitHub keys; say so in words a staff member
    // can act on rather than letting the helper throw a key name into a toast.
    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return NextResponse.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    try {
        return NextResponse.json(await getScheduledBackupState());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}

// PUT /api/settings/backup/workflow — { enabled: boolean }
export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return NextResponse.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") {
        return NextResponse.json({ error: "Expected { enabled: true | false }." }, { status: 400 });
    }

    try {
        await setScheduledBackupEnabled(body.enabled);
        // Read back rather than assuming: GitHub accepting the call is not proof the
        // state changed, and a switch that lies about this is worse than no switch.
        return NextResponse.json(await getScheduledBackupState());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
