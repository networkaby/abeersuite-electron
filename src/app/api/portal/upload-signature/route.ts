import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { cloudinarySignature } from "@/shared/lib/cloudinary";

// GET /api/portal/upload-signature — a signed Cloudinary upload for a signed-in
// customer's own photos (profile picture, social cover). Avatars folder only.
export async function GET(req: Request) {
    const { response } = await requirePortalCustomer();
    if (response) return response;

    const sig = cloudinarySignature("avatars", new URL(req.url).searchParams.get("format") === "jpg");
    if (!sig) return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
    return NextResponse.json(sig);
}
