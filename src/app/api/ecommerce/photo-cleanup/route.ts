import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { cleanupConfigured, deleteCloudFiles, planCleanup, type CleanupPlan } from "@/modules/ecommerce/lib/photoCleanup";

// GET  /api/ecommerce/photo-cleanup — dry run: what Clean would delete. Deletes nothing.
// POST /api/ecommerce/photo-cleanup — work the list out again and delete it from Cloudinary.
//
// POST never takes a list from the screen: it re-checks the whole database at the
// moment of deleting, so a photo put back on a product after the dry run is kept.
// See photoCleanup.ts for how "unused" is decided.

export const maxDuration = 300;

/** The dry run as the screen shows it — totals plus a few thumbnails, not every file. */
function summary(plan: CleanupPlan) {
    return {
        total: plan.total,
        totalBytes: plan.totalBytes,
        garbageCount: plan.garbage.length,
        garbageBytes: plan.garbageBytes,
        youngUnused: plan.youngUnused,
        samples: plan.garbage.slice(0, 24).map((f) => ({ url: f.url, publicId: f.publicId, createdAt: f.createdAt })),
    };
}

const notHere = () =>
    NextResponse.json({ error: "Cloudinary keys are not on this machine — run the cleanup from the office website." }, { status: 503 });

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_PHOTO_CLEANUP);
    if (response) return response;
    if (!cleanupConfigured()) return notHere();
    try {
        return NextResponse.json(summary(await planCleanup()));
    } catch (e) {
        return handleApiError(e, "Could not check Cloudinary");
    }
}

export async function POST() {
    const { user, response } = await requirePermission(PERMISSIONS.ECOMMERCE_PHOTO_CLEANUP);
    if (response) return response;
    if (!cleanupConfigured()) return notHere();
    try {
        const plan = await planCleanup();
        const ids = plan.garbage.map((f) => f.publicId);
        const deleted = await deleteCloudFiles(ids);
        console.info(`[photo-cleanup] user ${user.id} deleted ${deleted}/${ids.length} Cloudinary files (${plan.garbageBytes} bytes):`, ids.join(", "));
        return NextResponse.json({ deleted, freedBytes: plan.garbageBytes });
    } catch (e) {
        return handleApiError(e, "Cleanup failed");
    }
}
