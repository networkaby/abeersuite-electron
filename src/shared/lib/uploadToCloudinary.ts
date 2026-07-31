import axios from "axios";

// Client helper: fetch a signed payload from `signatureUrl` (the staff endpoint by
// default; pass the portal one for customers) and upload the file to Cloudinary.
// `file` may be a local File or a remote image URL string — Cloudinary fetches
// remote URLs server-side and stores its own copy either way. Returns the secure
// URL. Shared by the staff profile editor, the portal social profile editor, and
// the ecommerce product gallery.
export async function uploadImageToCloudinary(
    file: File | string,
    signatureUrl = "/api/upload-signature",
    folder?: string,
): Promise<string> {
    const { data: sig } = await axios.get<{
        timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string;
    }>(signatureUrl, folder ? { params: { folder } } : undefined);

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);

    const res = await axios.post<{ secure_url: string }>(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        form,
    );
    return res.data.secure_url;
}
