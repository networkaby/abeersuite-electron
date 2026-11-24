import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { listBackups } from "@/shared/lib/backup/dropbox";
import { backupAvailability } from "@/shared/lib/backup/availability";
import { knownApiError } from "@/shared/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings/restore/list — lists the .dump backups available in Dropbox
// so the restore picker can show them (newest first).
//
// Gated the same as the restore itself: the listing names every dump and when it was
// taken, which is what an unauthorised caller would need before triggering one.
//
// Also carries this machine's backup/restore availability. This is the one call the panel
// already makes on mount, so the panel can disable what cannot work without a second
// request — and a counter that was built without the Dropbox/GitHub keys answers 200 with
// an empty list rather than a 500, because "not configured here" is a state to show, not a
// failure to report.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const availability = await backupAvailability();
    if (!availability.canRestore) {
        return Response.json({ backups: [], ...availability });
    }

    try {
        const backups = await listBackups();
        return Response.json({ backups, ...availability });
    } catch (err) {
        const known = knownApiError(err);
        if (known) return known;
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }
}
