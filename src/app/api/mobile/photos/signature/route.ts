import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { cloudinarySignature } from "@/shared/lib/cloudinary";
import { PHOTO_FOLDER, PHOTO_KINDS, type PhotoKind } from "@/modules/mobile/lib/shopPhotos";

// GET /api/mobile/photos/signature?kind=product|brand|group|category
//
// A signed Cloudinary upload for the phone's Photos screen, into the same shop
// folder the office editor uses for that kind. The office's /api/upload-signature
// sits outside the phone-only fence; this one is inside it and asks for the
// photos tick.
export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    if (response) return response;

    const kind = req.nextUrl.searchParams.get("kind") ?? "";
    if (!(PHOTO_KINDS as readonly string[]).includes(kind)) {
        return NextResponse.json({ error: "Unknown photo kind" }, { status: 400 });
    }
    const sig = cloudinarySignature(PHOTO_FOLDER[kind as PhotoKind]);
    if (!sig) return NextResponse.json({ error: "Photo upload is not set up on the server" }, { status: 500 });
    return NextResponse.json(sig);
}
