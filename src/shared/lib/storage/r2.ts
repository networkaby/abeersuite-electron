import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Cloudflare R2 — presigned URLs (AWS SigV4, query-string form), no SDK.
 *
 * A presigned URL is the whole access story: the server signs a short-lived
 * GET to show a file, or a PUT for the browser / server to upload one. The
 * bucket itself stays private.
 *
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   .env (secret)
 *   CLOUDFLARE_ACCOUNT_ID                     .env
 */

const host = () => `${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const REGION = "auto";
const SERVICE = "s3";

export function isR2Configured(): boolean {
    return Boolean(
        process.env.CLOUDFLARE_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
    );
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");

/** RFC 3986 encoding, as SigV4 wants it ("/" kept in the path). */
function enc(s: string, keepSlash = false): string {
    return encodeURIComponent(s)
        .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(keepSlash ? /%2F/g : /$^/, "/");
}

/**
 * A presigned URL for one object. `GET` to read, `PUT` to upload (the uploader
 * must then send exactly the signed Content-Type header, if one was given).
 */
export function presignR2(args: {
    bucket: string;
    key: string;
    method: "GET" | "PUT" | "DELETE";
    expiresSec?: number;
    contentType?: string;
    /** GET only: ask the browser to download under this name. */
    downloadName?: string;
    /** Sign as of this time instead of now. A fixed time gives the same URL on
     *  every call, so the browser can cache the file (see mediaLink). */
    signedAt?: Date;
    /** GET only: let the browser keep the file this long (private cache). */
    cacheSeconds?: number;
}): string {
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secret = process.env.R2_SECRET_ACCESS_KEY;
    if (!accessKey || !secret) throw new Error("R2 is not set up (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");

    const now = args.signedAt ?? new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
    const path = `/${enc(args.bucket)}/${enc(args.key, true)}`;

    const signedHeaders = args.contentType ? "content-type;host" : "host";
    const q: Record<string, string> = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${accessKey}/${scope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(args.expiresSec ?? 900),
        "X-Amz-SignedHeaders": signedHeaders,
    };
    if (args.cacheSeconds) q["response-cache-control"] = `private, max-age=${args.cacheSeconds}`;
    if (args.downloadName) q["response-content-disposition"] = `attachment; filename="${args.downloadName.replace(/"/g, "")}"`;
    const query = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");

    const headers = args.contentType ? `content-type:${args.contentType}\nhost:${host()}\n` : `host:${host()}\n`;
    const canonical = [args.method, path, query, headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), REGION), SERVICE), "aws4_request");
    const signature = createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
    return `https://${host()}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** Server-side upload of bytes we already hold (e.g. a file fetched from Meta). */
export async function putR2(bucket: string, key: string, body: ArrayBuffer, contentType: string): Promise<void> {
    const url = presignR2({ bucket, key, method: "PUT", contentType, expiresSec: 300 });
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`R2 upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** Server-side read of a small text object (e.g. a saved JSON); null when it is not there. */
export async function getR2Text(bucket: string, key: string): Promise<string | null> {
    const res = await fetch(presignR2({ bucket, key, method: "GET", expiresSec: 300 }), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 read failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.text();
}

/** Server-side delete of one object. A missing object counts as deleted. */
export async function deleteR2(bucket: string, key: string): Promise<void> {
    const res = await fetch(presignR2({ bucket, key, method: "DELETE", expiresSec: 300 }), { method: "DELETE", signal: AbortSignal.timeout(10_000) });
    if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
