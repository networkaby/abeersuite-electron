"use client";

import axios from "axios";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { shrinkImage } from "@/shared/lib/browser/shrinkImage";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import type { PhotoKind } from "./shopPhotos";

/**
 * One photo from the phone, up to Cloudinary: shrunk first (a camera photo is
 * 5-8 MB), then sent to the kind's shop folder. Resolves to its link, which the
 * Photos screen then saves on the product or master. Throws an Error whose
 * message can be shown as it is.
 */
export async function uploadShopPhoto(file: File, kind: PhotoKind): Promise<string> {
    try {
        return await uploadImageToCloudinary(await shrinkImage(file), `/api/mobile/photos/signature?kind=${kind}`);
    } catch (e) {
        throw new Error(uploadErrorText(e));
    }
}

function uploadErrorText(e: unknown): string {
    if (axios.isAxiosError(e)) {
        if (!e.response) return "No internet — the photo was not sent. Try again.";
        // Cloudinary answers { error: { message } }; our own signature route { error }.
        const cloud = (e.response.data as { error?: { message?: unknown } } | undefined)?.error?.message;
        if (typeof cloud === "string" && cloud) return cloud;
    }
    return extractApiError(e, "Upload failed");
}
