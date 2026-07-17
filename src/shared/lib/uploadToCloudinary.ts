import axios from "axios";

// Client helper: fetch a signed payload from `signatureUrl` (the staff endpoint by
// default; pass the portal one for customers) and upload the file to Cloudinary.
// Returns the secure URL. Shared by the staff profile editor and the portal
// social profile editor.
export async function uploadImageToCloudinary(file: File, signatureUrl = "/api/upload-signature"): Promise<string> {
    const { data: sig } = await axios.get<{
        timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string;
    }>(signatureUrl);

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
