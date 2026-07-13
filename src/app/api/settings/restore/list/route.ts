import { requireAuth } from "@/shared/lib/auth/permissions";
import { listBackups } from "@/shared/lib/backup/dropbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings/restore/list — lists the .dump backups available in Dropbox
// so the restore picker can show them (newest first).
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const backups = await listBackups();
        return Response.json({ backups });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }
}
