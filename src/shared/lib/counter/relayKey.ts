import "server-only";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { COUNTER_KEY_RENEW_MS } from "@/shared/lib/constants/session";
import { hashCounterKey } from "@/shared/lib/counter/counterKeyHash";

/**
 * This till's own key for signing in at the office — the `WRITE_MODE=v_live` relay.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * The relay used to forward the cashier's cookie, which the office could read only
 * because every v_live installer carried the office's `AUTH_SECRET`: anyone with an
 * installer could mint an office session for any user, and one person's sign-out
 * anywhere ended the till's link too. Now each machine has its own secret, the cookie
 * never leaves the till, and the till signs in at the office as ITSELF — this key —
 * naming the person whose till session made the save (`counterRelayAuth.ts` is the
 * office half).
 *
 * ── Lifecycle (owner, 2026-10-13) ────────────────────────────────────────────
 * Minted by the till the first time it relays, no admin step: the till already
 * writes to Supabase directly (`prismaAuthoritative`), so an approval would guard
 * nothing the database password does not already open. Renewed every 30 days; the
 * previous hash stays good for one generation so a save already on the wire is never
 * refused. It never expires on its own — `PosCounter.relayKeyRevokedAt` ends it, and
 * while that is set the till does not mint a new one, so its writes run locally.
 *
 * Only the SHA-256 hash is stored in the database. The key itself lives in
 * `counter-relay-key.json` beside counter-setup.json, which survives updates.
 */

const FILE = "counter-relay-key.json";

type KeyFile = { counterId: number; key: string; issuedAt: number };

let current: KeyFile | null = null;
let minting: Promise<KeyFile | null> | null = null;

function filePath(): string | null {
    const dir = process.env.COUNTER_USER_DATA;
    return dir ? path.join(dir, FILE) : null;
}

function readFile(): KeyFile | null {
    const file = filePath();
    if (!file) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<KeyFile>;
        if (typeof data.counterId !== "number" || typeof data.key !== "string" || typeof data.issuedAt !== "number") return null;
        return { counterId: data.counterId, key: data.key, issuedAt: data.issuedAt };
    } catch {
        return null;
    }
}

function writeFile(data: KeyFile): void {
    const file = filePath();
    if (!file) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
}

/** Mint (or renew) and register the key. Null when the counter's key is revoked. */
async function mint(counterId: number): Promise<KeyFile | null> {
    const key = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const row = await prismaAuthoritative.posCounter.findUnique({
        where: { id: counterId },
        select: { relayKeyHash: true, relayKeyRevokedAt: true },
    });
    if (!row || row.relayKeyRevokedAt) return null;
    // Conditional on the hash we just read, so two server processes renewing at the
    // same moment cannot each push the other's fresh key out of the "previous" slot.
    const { count } = await prismaAuthoritative.posCounter.updateMany({
        where: { id: counterId, relayKeyRevokedAt: null, relayKeyHash: row.relayKeyHash },
        data: { relayKeyPrevHash: row.relayKeyHash, relayKeyHash: hashCounterKey(key), relayKeyIssuedAt: now },
    });
    if (count === 0) return null;
    const data = { counterId, key, issuedAt: now.getTime() };
    writeFile(data);
    console.log(`[relayKey] ${row.relayKeyHash ? "renewed" : "issued"} the office key for counter ${counterId}.`);
    return data;
}

/**
 * The `Authorization` value for a relayed request, or null when this till cannot sign
 * in at the office (no counter, revoked, database unreachable) — the caller then runs
 * the request locally, as for any relay it cannot make.
 */
export async function counterAuthorization(): Promise<string | null> {
    const counterId = readCounterSetup()?.counterId;
    if (!counterId) return null;
    if (!current || current.counterId !== counterId) current = readFile();
    const fresh = current && current.counterId === counterId && Date.now() - current.issuedAt < COUNTER_KEY_RENEW_MS;
    if (!fresh) {
        const stale = current && current.counterId === counterId ? current : null;
        minting ??= mint(counterId)
            .catch((err) => {
                console.error("[relayKey] could not register this counter's office key:", err);
                return null;
            })
            .finally(() => { minting = null; });
        // A due renewal that fails (offline) keeps the old key: it has not expired.
        current = (await minting) ?? stale;
    }
    return current ? `Counter ${current.counterId}.${current.key}` : null;
}

/** The office refused the key (revoked, or renewed by another process). Forget it so
 *  the next relay re-reads the file or mints anew — which a revoke refuses. */
export function forgetCounterKey(): void {
    current = null;
    const file = filePath();
    const onDisk = readFile();
    if (file && onDisk && Date.now() - onDisk.issuedAt > 60_000) {
        try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
}
