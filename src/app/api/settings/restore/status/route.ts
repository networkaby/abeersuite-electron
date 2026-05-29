import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { isValidJobId, readJson, restoreStatusPath } from "@/shared/lib/backup/backupStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestoreStatus = { ok: boolean; code: string; log: string };

// GET /api/settings/restore/status?jobId=… — polled while the GitHub restore
// run is in flight. The workflow writes restores/<jobId>.status.json when done.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!isValidJobId(jobId)) {
        return Response.json({ error: "Invalid jobId." }, { status: 400 });
    }

    let status: RestoreStatus | null;
    try {
        status = await readJson<RestoreStatus>(restoreStatusPath(jobId));
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    if (!status) return Response.json({ done: false });
    return Response.json({ done: true, ok: status.ok, log: status.log });
}
