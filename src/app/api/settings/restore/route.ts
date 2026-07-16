import { requireAuth } from "@/shared/lib/auth/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { isUnderBackupFolder } from "@/shared/lib/backup/dropbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/restore — triggers the GitHub Actions run that downloads
// the chosen dump from Dropbox and runs pg_restore. Fire-and-forget: the user
// picks a file already in Dropbox (see /api/settings/restore/list), so nothing
// is uploaded through the browser and the page can be closed after triggering.
// Requires confirm === "RESTORE".
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const body = (await req.json().catch(() => null)) as { path?: string; confirm?: string } | null;
    if (!body || body.confirm !== "RESTORE") {
        return Response.json({ error: "Type RESTORE to confirm." }, { status: 400 });
    }
    if (!isUnderBackupFolder(body.path)) {
        return Response.json({ error: "Invalid or unsupported backup path." }, { status: 400 });
    }

    try {
        await triggerWorkflow(process.env.GITHUB_RESTORE_WORKFLOW?.trim() || "restore.yml", { file_path: body.path });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true });
}
