import "server-only";
import crypto from "crypto";

/**
 * AES-256-GCM lock for every secret we save in the database. Two locks:
 *   - scramble: SCRAMBLE_KEY_SECRET — the same on Vercel and every office till, so a
 *     secret pasted on a page opens wherever the app runs. Locks AI keys, App Settings
 *     secrets, Incoming API secrets and the saved Facebook / Google access.
 *     (Was AI_KEY_SECRET until 2026-11-13 — same value, renamed by the owner.)
 *   - machine: AUTH_SECRET — one per PC on a till (electron/main.ts
 *     ensureAuthSecret), so a key saved in this PC's file opens nowhere else.
 * Format: "v1:<iv>:<tag>:<cipher>", base64 parts.
 */

export type SecretLock = "scramble" | "machine";

/** The env var behind the scramble lock — every message names it from here. */
export const SCRAMBLE_SECRET_ENV = "SCRAMBLE_KEY_SECRET";

const secretFor = (lock: SecretLock) =>
    (lock === "scramble" ? process.env.SCRAMBLE_KEY_SECRET : process.env.AUTH_SECRET)?.trim() || "";

/** The scramble lock is set here — without it a pasted secret can be neither saved nor read. */
export const hasScrambleSecret = () => secretFor("scramble").length >= 16;

/** Never change: the lock's old name ("shared") is part of the key, so every saved
 *  secret stays readable after the rename. */
const DERIVE_NAME: Record<SecretLock, string> = { scramble: "shared", machine: "machine" };

const keyOf = (lock: SecretLock) => {
    const secret = secretFor(lock);
    if (secret.length < 16) throw new Error(lock === "scramble" ? `${SCRAMBLE_SECRET_ENV} is not set` : "AUTH_SECRET is not set");
    return crypto.createHash("sha256").update(`abeer-ai:${DERIVE_NAME[lock]}:${secret}`).digest();
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
