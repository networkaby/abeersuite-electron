import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

    if (!apiKey || !apiSecret || !cloudName) {
        return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder    = "avatars";

    // Cloudinary signature: alphabetical sort, concat with secret, SHA1
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash("sha1")
        .update(`${paramsToSign}${apiSecret}`)
        .digest("hex");

    return NextResponse.json({ timestamp, signature, apiKey, cloudName, folder });
}
