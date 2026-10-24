import axios from "axios";

// Client helper: fetch a signed payload from `signatureUrl` (the staff endpoint by
// default; pass the portal one for customers) and upload the file to Cloudinary.
// `file` may be a local File or a remote image URL string — Cloudinary fetches
// remote URLs server-side and stores its own copy either way. Returns the secure
// URL. Shared by the staff profile editor, the portal social profile editor, and
// the ecommerce product gallery.
/** HEIC/HEIF (iPhone and some Android cameras) — by MIME type, else by extension. */
function isHeif(file: File | string): boolean {
    if (typeof file !== "string" && /^image\/hei[cf]/i.test(file.type)) return true;
    const name = typeof file === "string" ? file.split(/[?#]/)[0] : file.name;
    return /\.hei[cf]$/i.test(name);
}

export async function uploadImageToCloudinary(
    file: File | string,
    signatureUrl = "/api/upload-signature",
    folder?: string,
): Promise<string> {
    // A HEIC photo is stored as JPG — the signature must carry the same `format`.
    const toJpg = isHeif(file);
    const { data: sig } = await axios.get<{
        timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string; format?: "jpg";
    }>(signatureUrl, { params: { ...(folder ? { folder } : {}), ...(toJpg ? { format: "jpg" } : {}) } });

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);
    if (sig.format) form.append("format", sig.format);

    const res = await axios.post<{ secure_url: string }>(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        form,
    );
    return res.data.secure_url;
}
