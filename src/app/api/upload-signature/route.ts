import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { cloudinarySignature } from "@/shared/lib/cloudinary";

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const params = new URL(req.url).searchParams;
    const sig = cloudinarySignature(params.get("folder"), params.get("format") === "jpg");
    if (!sig) return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
    return NextResponse.json(sig);
}
