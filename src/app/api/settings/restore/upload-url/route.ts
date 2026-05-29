import { randomUUID } from "crypto";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createSignedUpload, restorePath } from "@/shared/lib/backup/backupStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/restore/upload-url — hands the browser a signed URL to
// upload the dump straight to Storage (bypassing Vercel's request body limit).
// Returns the jobId used to key the file and, later, trigger the restore.
export async function POST() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const jobId = randomUUID();
    try {
        const uploadUrl = await createSignedUpload(restorePath(jobId));
        return Response.json({ jobId, uploadUrl });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }
}
