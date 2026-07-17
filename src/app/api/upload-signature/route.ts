import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { cloudinarySignature } from "@/shared/lib/cloudinary";

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const sig = cloudinarySignature(new URL(req.url).searchParams.get("folder"));
    if (!sig) return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
    return NextResponse.json(sig);
}
