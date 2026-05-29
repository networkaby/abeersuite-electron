import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { isValidJobId } from "@/shared/lib/backup/backupStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/restore — the browser has already uploaded the dump to
// restores/<jobId>.dump via a signed URL. This triggers the GitHub Actions run
// that downloads it and runs pg_restore. Requires confirm === "RESTORE".
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const body = (await req.json().catch(() => null)) as { jobId?: string; confirm?: string } | null;
    if (!body || body.confirm !== "RESTORE") {
        return Response.json({ error: "Type RESTORE to confirm." }, { status: 400 });
    }
    if (!isValidJobId(body.jobId)) {
        return Response.json({ error: "Invalid jobId." }, { status: 400 });
    }

    try {
        await triggerWorkflow(process.env.GITHUB_RESTORE_WORKFLOW?.trim() || "restore.yml", { job_id: body.jobId });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true });
}
