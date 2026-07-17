import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { cloudinarySignature } from "@/shared/lib/cloudinary";

// GET /api/portal/social/upload-signature — a signed Cloudinary upload for a
// signed-in customer's social profile photo (avatars folder only).
export async function GET() {
    const { response } = await requirePortalCustomer();
    if (response) return response;

    const sig = cloudinarySignature("avatars");
    if (!sig) return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
    return NextResponse.json(sig);
}
