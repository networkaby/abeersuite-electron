"use client";

/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * A phone camera photo is 4000px and 5-8 MB; the shop never shows one wider than
 * ~1200px, and Cloudinary resizes on delivery anyway. Sending the full file costs
 * staff mobile data and a long wait on a weak signal, so the long side is capped
 * and the result re-encoded as JPEG — typically 300-600 KB.
 *
 * `imageOrientation: "from-image"` applies the camera's EXIF rotation, so a photo
 * taken upright stays upright once the EXIF block is gone.
 *
 * Never fails: an image the browser cannot decode (HEIC on some phones), or one
 * already small, is returned untouched and Cloudinary takes it as it is.
 */

const MAX_SIDE = 1600;
const QUALITY = 0.85;
/** Below this the file is sent as is — re-encoding a small image only loses detail. */
const SMALL_BYTES = 600 * 1024;

export async function shrinkImage(file: File): Promise<File> {
    if (file.size <= SMALL_BYTES || typeof createImageBitmap !== "function") return file;
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return file;
        // JPEG has no transparency: a PNG logo's clear corners would turn black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
        if (!blob || blob.size >= file.size) return file;
        const name = file.name.replace(/\.[^.]+$/, "") || "photo";
        return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    } catch {
        return file;
    }
}
