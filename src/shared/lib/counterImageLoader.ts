import type { ImageLoaderProps } from "next/image";
import { buildUrl, isCloudinaryUrl } from "./cloudinaryImage";

/**
 * The counter build's app-wide `<Image>` loader (next.config `images.loaderFile`).
 *
 * Cloudinary uploads get Cloudinary's own resized, format-converted copy — the same
 * URL the web build's per-image loader asks for. Everything else comes back as the
 * raw URL, so the counter's Node server never fetches the internet for an image
 * (the reason the counter used to set `images.unoptimized`, which also threw away
 * the Cloudinary loader and made every photo download its full-size original — a
 * phone's HEIC original not loading at all in Chromium).
 */
export default function counterImageLoader({ src, width, quality }: ImageLoaderProps): string {
    return isCloudinaryUrl(src) ? buildUrl(src, { width, quality: quality ?? undefined }) : src;
}
