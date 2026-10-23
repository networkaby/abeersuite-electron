import "server-only";
import { mediaLink } from "@/modules/message/lib/customerMessages";

/**
 * The Status / Channel file of a campaign lives in the same private R2 bucket as
 * WhatsApp chat attachments, under its own prefix, and is shown through the same
 * cache-friendly signed links (mediaLink).
 */

export const campaignMediaPrefix = (campaignId: number) => `campaigns/${campaignId}/`;

export function campaignMediaKey(campaignId: number, fileName: string): string {
    const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
    return `${campaignMediaPrefix(campaignId)}${Date.now().toString(36)}-${safe}`;
}

/** Adds the view and download links a campaign row's file needs on screen. */
export function withMediaLinks<T extends { mediaKey: string | null; mediaName: string | null }>(row: T) {
    return {
        ...row,
        mediaUrl: mediaLink(row.mediaKey),
        mediaDownloadUrl: mediaLink(row.mediaKey, row.mediaName, true),
    };
}
