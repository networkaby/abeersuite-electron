import "server-only";
import crypto from "crypto";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { hasSharedSecret, lockSecret, unlockSecret } from "@/shared/lib/ai/secretBox";
import { INCOMING_APIS, type IncomingId } from "@/modules/incoming/lib/incomingCatalog";

/**
 * Settings → Incoming API: the secret each outside caller must send, and its
 * settings. Read from the IncomingApi table, cached per server instance (every
 * cron run and webhook would otherwise read it), cleared on save.
 *
 * Which secret counts, per caller:
 *   - the one saved on the page, when the caller is switched on;
 *   - the old env var too (CRON_SECRET, …), so a caller set up before this page
 *     keeps working — Vercel's own nightly backup cron can only send CRON_SECRET;
 *   - neither set → the caller's old rule: open for the legacy callers (as
 *     before), always shut for the Cowork agent, which never had an env var.
 * Switched off on the page → shut, env var included.
 */

type Row = { enabled: boolean; secret: string | null; settings: Record<string, unknown>; lastUsedAt: Date | null };

const CACHE_MS = 60_000;
let cache: { at: number; rows: Map<string, Row> } | null = null;

export function clearIncomingCache() {
    cache = null;
}

async function rows(): Promise<Map<string, Row>> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
    const list = await prisma.incomingApi.findMany({ select: { id: true, enabled: true, secretEnc: true, settings: true, lastUsedAt: true } });
    const map = new Map<string, Row>();
    for (const r of list) {
        map.set(r.id, {
            enabled: r.enabled,
            secret: r.secretEnc && hasSharedSecret() ? unlockSecret(r.secretEnc, "shared") : null,
            settings: (r.settings ?? {}) as Record<string, unknown>,
            lastUsedAt: r.lastUsedAt,
        });
    }
    cache = { at: Date.now(), rows: map };
    return map;
}

const envSecret = (id: IncomingId) => {
    const v = INCOMING_APIS[id].envVar;
    return (v && process.env[v]?.trim()) || null;
};

/** The secret value itself (Meta's app secret signs; the verify token is echoed). Page first, then env. */
export async function incomingSecret(id: IncomingId): Promise<{ value: string | null; enabled: boolean }> {
    const row = (await rows()).get(id);
    if (row && !row.enabled) return { value: null, enabled: false };
    return { value: row?.secret || envSecret(id), enabled: true };
}

/** Caller-specific settings saved on the page. */
export async function incomingSettings(id: IncomingId): Promise<Record<string, unknown>> {
    return (await rows()).get(id)?.settings ?? {};
}

const same = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// "Last used" is written at most once per 5 minutes per caller — not on every cron run.
const TOUCH_EVERY_MS = 5 * 60_000;
function touch(id: IncomingId, row: Row | undefined) {
    if (IS_COUNTER_PC || !row || (row.lastUsedAt && Date.now() - row.lastUsedAt.getTime() < TOUCH_EVERY_MS)) return;
    row.lastUsedAt = new Date();
    void prisma.incomingApi.update({ where: { id }, data: { lastUsedAt: row.lastUsedAt } }).catch(() => undefined);
}

/** The key a caller sent: `x-api-key`, or `Authorization: Bearer …` (cron-job.org, Vercel cron). */
export function sentKey(req: Request): string | null {
    const h = req.headers.get("x-api-key")?.trim();
    if (h) return h;
    const auth = req.headers.get("authorization")?.trim();
    return auth?.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

/**
 * Does this request carry the caller's key? See the header comment for the
 * rule. Use as `if (!(await requireIncomingKey(req, "CRON"))) return 401`.
 */
export async function requireIncomingKey(req: Request, id: IncomingId): Promise<boolean> {
    const row = (await rows()).get(id);
    if (row && !row.enabled) return false;
    const env = envSecret(id);
    const saved = row?.secret ?? null;
    if (!saved && !env) return !INCOMING_APIS[id].closedWhenUnset;
    const got = sentKey(req);
    if (!got) return false;
    if ((saved && same(got, saved)) || (env && same(got, env))) {
        touch(id, row);
        return true;
    }
    return false;
}

// ── The page ──────────────────────────────────────────────────────────────────

export type IncomingStatus = {
    id: IncomingId;
    enabled: boolean;
    /** Where the working secret comes from now. */
    source: "page" | "env" | "none";
    hint: string | null;
    settings: Record<string, unknown>;
    lastUsedAt: string | null;
    updatedByName: string | null;
};

export async function incomingStatus(): Promise<{ canLock: boolean; rows: IncomingStatus[] }> {
    const saved = new Map(
        (await prisma.incomingApi.findMany({ select: { id: true, enabled: true, secretEnc: true, secretHint: true, settings: true, lastUsedAt: true, updatedByName: true } })).map((r) => [r.id, r]),
    );
    const out = (Object.keys(INCOMING_APIS) as IncomingId[]).map((id) => {
        const r = saved.get(id);
        const env = envSecret(id);
        return {
            id,
            enabled: r?.enabled ?? true,
            source: r?.secretEnc ? "page" : env ? "env" : "none",
            hint: r?.secretHint ?? (env ? env.slice(-4) : null),
            settings: (r?.settings ?? {}) as Record<string, unknown>,
            lastUsedAt: r?.lastUsedAt?.toISOString() ?? null,
            updatedByName: r?.updatedByName ?? null,
        } satisfies IncomingStatus;
    });
    return { canLock: hasSharedSecret(), rows: out };
}

/** A new random key, as staff copy it into the other program. */
export const newKey = () => crypto.randomBytes(24).toString("base64url");

/**
 * Save one caller. `secret` a value to keep (pasted, or `newKey()`), `""` to
 * forget the page's secret (the env var then counts again).
 */
export async function saveIncoming(
    id: IncomingId,
    p: { enabled?: boolean; secret?: string; settings?: Record<string, unknown> },
    byName: string | null,
) {
    const secretData =
        p.secret === undefined
            ? {}
            : p.secret === ""
              ? { secretEnc: null, secretHint: null }
              : { secretEnc: lockSecret(p.secret, "shared"), secretHint: p.secret.slice(-4) };
    const data = {
        ...(p.enabled === undefined ? {} : { enabled: p.enabled }),
        ...secretData,
        ...(p.settings ? { settings: p.settings as object } : {}),
        updatedByName: byName,
    };
    await prisma.incomingApi.upsert({ where: { id }, create: { id, ...data }, update: data });
    clearIncomingCache();
}
