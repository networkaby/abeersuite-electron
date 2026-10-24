import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";

/**
 * Photos already in Cloudinary whose "attach to the product" save has not been
 * confirmed yet, kept on this phone so leaving the screen or closing the app
 * never strands one. The Photos screen attaches them again when it opens.
 */
const key = (productId: number) => `mobile:unsavedPhotos:${productId}`;

export function readUnsaved(productId: number): string[] {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(key(productId)) ?? "[]");
        return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : [];
    } catch {
        return [];
    }
}

function write(productId: number, urls: string[]) {
    try {
        if (urls.length) localStorage.setItem(key(productId), JSON.stringify(urls));
        else localStorage.removeItem(key(productId));
    } catch {
        /* storage blocked — the on-screen Retry still holds the link */
    }
}

export function rememberUnsaved(productId: number, url: string) {
    const list = readUnsaved(productId);
    if (!list.includes(url)) write(productId, [...list, url]);
}

export function forgetUnsaved(productId: number, urls: string[]) {
    write(productId, readUnsaved(productId).filter((u) => !urls.includes(u)));
}

/** A save that never got an answer (network drop, app paused) — worth trying again. */
export function isNoAnswer(e: unknown): boolean {
    return axios.isAxiosError(e) && !e.response;
}

/** Why the save failed, in words staff can pass on — the real cause, not a guess. */
export function saveFailureText(e: unknown): string {
    if (axios.isAxiosError(e) && !e.response) {
        const why = e.code === "ECONNABORTED" || e.code === "ETIMEDOUT" ? "timed out"
            : typeof navigator !== "undefined" && !navigator.onLine ? "phone is offline"
            : typeof document !== "undefined" && document.visibilityState === "hidden" ? "app was in the background"
            : `network error${e.code ? ` ${e.code}` : ""}`;
        return `Photo uploaded but not attached yet (${why}). It will attach when you retry or reopen this screen.`;
    }
    return extractApiError(e, "Could not save the photo.");
}
