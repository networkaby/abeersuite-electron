/**
 * Browser side of an R2 upload: PUT a file to a signed URL from an `…/upload-url`
 * route. A failure throws `StorageUploadError` with a reason staff can act on —
 * `extractApiError` shows its message instead of the bare fallback.
 *
 * The browser cannot tell a CORS refusal from no internet (both are a TypeError
 * with no status), so that case names both. A CORS refusal is what a counter
 * gets when the bucket's AllowedOrigins lacks http://127.0.0.1:786.
 *
 * Usage:
 *   await putToSignedUrl(data.putUrl, file, type);
 */
export class StorageUploadError extends Error {}

export async function putToSignedUrl(url: string, file: Blob, type: string): Promise<void> {
    let res: Response;
    try {
        res = await fetch(url, { method: "PUT", headers: { "Content-Type": type }, body: file });
    } catch {
        throw new StorageUploadError("File storage refused this computer, or could not be reached — nothing was sent.");
    }
    if (res.ok) return;
    throw new StorageUploadError(
        res.status === 403
            ? "File storage refused the upload (403) — check this PC's clock, then try again."
            : `File storage did not take the file (${res.status}) — nothing was sent.`,
    );
}
