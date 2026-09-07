import { createHash } from "crypto";

// Shared Cloudinary upload-signature builder, used by both the staff
// (/api/upload-signature) and portal (/api/portal/upload-signature)
// endpoints. Signs an upload to a whitelisted folder; returns null when the
// Cloudinary env vars aren't configured.

const ALLOWED_FOLDERS = ["avatars", "shop/products"] as const;
type CloudinaryFolder = (typeof ALLOWED_FOLDERS)[number];

export interface CloudinarySignature {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
}

export function cloudinarySignature(rawFolder?: string | null): CloudinarySignature | null {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (!apiKey || !apiSecret || !cloudName) return null;

    const folder: CloudinaryFolder =
        rawFolder && (ALLOWED_FOLDERS as readonly string[]).includes(rawFolder)
            ? (rawFolder as CloudinaryFolder)
            : "avatars";

    const timestamp = Math.round(Date.now() / 1000);
    // Cloudinary signature: alphabetical param sort, concat with secret, SHA1.
    const signature = createHash("sha1")
        .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
        .digest("hex");

    return { timestamp, signature, apiKey, cloudName, folder };
}
