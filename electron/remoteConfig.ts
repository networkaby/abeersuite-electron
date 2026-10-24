import { app, net, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { writeJsonAtomic } from "./stateFile";

/**
 * The till's database settings, fetched from the office instead of baked in.
 *
 * The installer carries `COUNTER_INSTALL_SECRET`, not `DATABASE_URL`
 * (scripts/counterEnv.ts). At every start the till shows that secret to the office
 * (`POST /api/counter/config`) and gets the value Vercel holds, so a password changed
 * on Vercel reaches every till at its next start without a rebuild.
 *
 * The answer is kept in `remote-config.json`, locked with Windows' own encryption
 * (safeStorage — this Windows user on this PC only), so a till with no internet still
 * starts and bills. A copy taken to another PC does not open.
 *
 * A per-machine `%APPDATA%/abeersuite-electron/.env` still wins: a key it sets is never
 * fetched or replaced, so one till can be pointed at a test database as before.
 */

/** Keys the office hands out. Keep in step with `SHARED_KEYS` in
 *  src/app/api/counter/config/route.ts — a key not listed here is ignored. */
const SHARED_KEYS = ["DATABASE_URL"] as const;
const FILE = "remote-config.json";
const TIMEOUT_MS = 10_000;
/** First start has no saved copy, and Windows may not have the network up yet at
 *  autostart — so try for a while before giving up. With a saved copy, once is enough. */
const FIRST_START_ATTEMPTS = 4;
const RETRY_GAP_MS = 5_000;

type Shared = Partial<Record<(typeof SHARED_KEYS)[number], string>>;

function filePath(): string {
    return path.join(app.getPath("userData"), FILE);
}

/** `COUNTER_CONFIG_URL`, else the v_live relay target — same rule as
 *  `counterConfigOrigin` in scripts/counterEnv.ts. */
function configOrigin(): string | null {
    const raw = (process.env.COUNTER_CONFIG_URL || process.env.WRITE_API_URL || "").trim();
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

function pick(body: unknown): Shared | null {
    if (!body || typeof body !== "object") return null;
    const out: Shared = {};
    for (const key of SHARED_KEYS) {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out.DATABASE_URL ? out : null;
}

async function fetchOnce(origin: string, secret: string): Promise<Shared | null> {
    try {
        const res = await net.fetch(new URL("/api/counter/config", origin).toString(), {
            method: "POST",
            headers: { Authorization: `Install ${secret}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[remoteConfig] The office answered HTTP ${res.status}.`);
            return null;
        }
        return pick(await res.json());
    } catch (err) {
        console.warn("[remoteConfig] Could not reach the office:", err instanceof Error ? err.message : err);
        return null;
    }
}

function readSaved(): Shared | null {
    try {
        const file = filePath();
        if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
        const { locked } = JSON.parse(fs.readFileSync(file, "utf-8")) as { locked?: unknown };
        if (typeof locked !== "string") return null;
        return pick(JSON.parse(safeStorage.decryptString(Buffer.from(locked, "base64"))));
    } catch {
        // Locked by another Windows user or PC, or damaged — the next good fetch replaces it.
        return null;
    }
}

function save(shared: Shared): void {
    if (!safeStorage.isEncryptionAvailable()) {
        // Never written in plain text. The till still runs, but cannot start offline.
        console.warn("[remoteConfig] Windows encryption is not available — no offline copy kept.");
        return;
    }
    try {
        const locked = safeStorage.encryptString(JSON.stringify(shared)).toString("base64");
        writeJsonAtomic(filePath(), { savedAt: new Date().toISOString(), locked }, { mode: 0o600 });
    } catch (err) {
        console.error("[remoteConfig] Could not save the offline copy:", err);
    }
}

/**
 * Fills the shared keys into process.env before anything opens the database.
 * Returns why it could not, or null when every key is set.
 */
export async function loadRemoteConfig(onWait: (message: string) => void): Promise<string | null> {
    const missing = SHARED_KEYS.filter((key) => !process.env[key]?.trim());
    if (missing.length === 0) return null;

    const secret = process.env.COUNTER_INSTALL_SECRET?.trim();
    const origin = configOrigin();
    const saved = readSaved();
    let fresh: Shared | null = null;
    if (secret && origin) {
        const attempts = saved ? 1 : FIRST_START_ATTEMPTS;
        for (let i = 1; i <= attempts && !fresh; i++) {
            if (i > 1) {
                onWait(`Waiting for the internet to fetch settings… (try ${i} of ${attempts})`);
                await new Promise((resolve) => setTimeout(resolve, RETRY_GAP_MS));
            }
            fresh = await fetchOnce(origin, secret);
        }
    }

    if (fresh) save(fresh);
    else if (saved) console.log("[remoteConfig] Office not reachable — starting with the saved copy.");
    const use = fresh ?? saved;
    if (!use) {
        return !secret || !origin
            ? "this installer has no COUNTER_INSTALL_SECRET or office address — rebuild it"
            : `the office (${origin}) could not be reached, and this PC has no saved copy yet — connect to the internet and start again`;
    }
    for (const key of missing) {
        if (use[key]) process.env[key] = use[key];
    }
    return null;
}
