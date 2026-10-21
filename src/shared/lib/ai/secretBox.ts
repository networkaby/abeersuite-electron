import "server-only";
import crypto from "crypto";

/**
 * AES-256-GCM lock for AI keys. Two locks, two secrets:
 *   - shared: AI_KEY_SECRET — the same on Vercel and every office till, so a key
 *     pasted on the page (AiKey.secretEnc) opens wherever the app runs.
 *   - machine: AUTH_SECRET — one per PC on a till (electron/main.ts
 *     ensureAuthSecret), so a key saved in this PC's file opens nowhere else.
 * Format: "v1:<iv>:<tag>:<cipher>", base64 parts.
 */

export type SecretLock = "shared" | "machine";

const secretFor = (lock: SecretLock) =>
    (lock === "shared" ? process.env.AI_KEY_SECRET : process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)?.trim() || "";

/** The shared lock is set here — without it a pasted (db) key can be neither saved nor read. */
export const hasSharedSecret = () => secretFor("shared").length >= 16;

const keyOf = (lock: SecretLock) => {
    const secret = secretFor(lock);
    if (secret.length < 16) throw new Error(lock === "shared" ? "AI_KEY_SECRET is not set" : "AUTH_SECRET is not set");
    return crypto.createHash("sha256").update(`abeer-ai:${lock}:${secret}`).digest();
};

export function lockSecret(plain: string, lock: SecretLock): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyOf(lock), iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

/** null when it was locked with another secret, or is not ours. */
export function unlockSecret(boxed: string, lock: SecretLock): string | null {
    try {
        const [v, iv, tag, enc] = boxed.split(":");
        if (v !== "v1" || !iv || !tag || !enc) return null;
        const decipher = crypto.createDecipheriv("aes-256-gcm", keyOf(lock), Buffer.from(iv, "base64"));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}
