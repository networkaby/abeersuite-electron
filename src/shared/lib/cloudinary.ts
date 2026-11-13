import { createHash } from "crypto";
import { appSetting } from "@/shared/lib/settings/appSettings.server";

// Shared Cloudinary upload-signature builder, used by both the staff
// (/api/upload-signature) and portal (/api/portal/upload-signature)
// endpoints. Signs an upload to a whitelisted folder; returns null when the
// Cloudinary env vars aren't configured.

// Every folder an upload field asks for must be listed — an unlisted one is not
// refused, it lands in "avatars" (brand logos and banners once did).
const ALLOWED_FOLDERS = [
    "avatars",
    "shop/products",
    "shop/brands",
    "shop/groups",
    "shop/categories",
    "shop/home/hero",
    "shop/home/banners",
    "shop/ads",
] as const;
export type CloudinaryFolder = (typeof ALLOWED_FOLDERS)[number];

export interface CloudinarySignature {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
    /** Set when the upload is signed to be stored as JPG (see storeAsJpg). */
    format?: "jpg";
}

/**
 * `storeAsJpg` signs `format=jpg`, so Cloudinary saves the upload as a JPG. The
 * client asks for it only for a HEIC/HEIF photo (iPhones, some Androids): a stored
 * .heic shows nowhere a raw link is used — Chromium/the desktop app, WhatsApp, a
 * print. Everything else keeps its own format, so a PNG logo keeps its transparency.
 */
export async function cloudinarySignature(rawFolder?: string | null, storeAsJpg = false): Promise<CloudinarySignature | null> {
    // Settings → App Settings, else .env. The cloud name is NEXT_PUBLIC (built into the site).
    const apiKey = await appSetting("CLOUDINARY_API_KEY");
    const apiSecret = await appSetting("CLOUDINARY_API_SECRET");
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (!apiKey || !apiSecret || !cloudName) return null;

    const folder: CloudinaryFolder =
        rawFolder && (ALLOWED_FOLDERS as readonly string[]).includes(rawFolder)
            ? (rawFolder as CloudinaryFolder)
            : "avatars";

    const timestamp = Math.round(Date.now() / 1000);
    // Cloudinary signature: alphabetical param sort, concat with secret, SHA1.
    const formatParam = storeAsJpg ? "&format=jpg" : "";
    const signature = createHash("sha1")
        .update(`folder=${folder}${formatParam}&timestamp=${timestamp}${apiSecret}`)
        .digest("hex");

    return { timestamp, signature, apiKey, cloudName, folder, ...(storeAsJpg ? { format: "jpg" as const } : {}) };
}
