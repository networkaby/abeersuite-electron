// "Skip for AI" mark on a gallery photo, stored IN THE URL as a fragment
// (`…/abc.jpg#ai-skip`) — the same trick as the crop adjustment in
// cloudinaryImage.ts. A fragment never reaches the server, so the shop, POS,
// phone app and counters load the photo exactly as before, `galleryJson` stays
// a plain string[] that every reader (and every till not yet updated) keeps,
// and the mark moves with the photo when it is reordered, cropped or copied.
// No migration, no counter release.

const AI_SKIP_MARK = "#ai-skip";

/** Staff marked this photo "do not send to AI" (an ad, a duplicate, another product). */
export function isAiSkipped(url: string): boolean {
    return url.endsWith(AI_SKIP_MARK);
}

/** Add or remove the mark; the rest of the URL is untouched. */
export function setAiSkipped(url: string, skip: boolean): string {
    const bare = isAiSkipped(url) ? url.slice(0, -AI_SKIP_MARK.length) : url;
    return skip ? `${bare}${AI_SKIP_MARK}` : bare;
}

/** The photos the AI should see: every one staff did not mark, in gallery order.
 *  No cap — each adds ~1,100 input tokens (≈ ₹0.05 on the paid key) and a few seconds. */
export function photosForAi(urls: string[]): string[] {
    return urls.filter((u) => /^https?:\/\//.test(u) && !isAiSkipped(u));
}
