import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { dumpPath, getSignedDownloadUrl, isValidJobId } from "@/shared/lib/backup/backupStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings/backup/status?jobId=… — polled by the client while the
// GitHub backup run is in flight. Returns a signed download URL once the dump
// has landed in Storage.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!isValidJobId(jobId)) {
        return Response.json({ error: "Invalid jobId." }, { status: 400 });
    }

    let url: string | null;
    try {
        url = await getSignedDownloadUrl(dumpPath(jobId));
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ready: Boolean(url), url: url ?? undefined });
}
