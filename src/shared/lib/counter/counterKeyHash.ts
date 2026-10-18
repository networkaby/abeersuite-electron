import { createHash } from "node:crypto";

/** The till's counter key and the office's check of it hash the same way — the
 *  database only ever holds this. A 32-byte random key needs no salt or slow hash. */
export function hashCounterKey(key: string): string {
    return createHash("sha256").update(key).digest("base64url");
}

/** Written with every release and every bind: a counter's office key belongs to the PC
 *  that held it, so a new PC mints its own and the old one's stops working. */
export const RELAY_KEY_CLEARED = { relayKeyHash: null, relayKeyPrevHash: null, relayKeyIssuedAt: null } as const;
