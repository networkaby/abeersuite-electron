import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { cleanupConfigured, photoLibrary } from "@/modules/ecommerce/lib/photoCleanup";

// GET /api/ecommerce/photo-library — every shop photo in Cloudinary, newest first,
// each marked used / unused, for the product page's "From library" picker.
// Read-only; cached a few minutes (photoCleanup.ts).

export const maxDuration = 120;

export async function GET() {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    if (!cleanupConfigured()) {
        return NextResponse.json({ error: "Cloudinary keys are not on this machine — open the library from the office website." }, { status: 503 });
    }
    try {
        return NextResponse.json({ photos: await photoLibrary() });
    } catch (e) {
        return handleApiError(e, "Could not load the photo library");
    }
}
