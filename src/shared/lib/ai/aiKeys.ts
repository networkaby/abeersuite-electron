import "server-only";
import { APICallError, RetryError, generateText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Prisma } from "@/generated/prisma/client";
import { prisma, prismaLive } from "@/shared/lib/prisma/prismaClient";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { aiProviderInfo, AI_COPY_FLOWS, AI_DEFAULT_COPY_FLOW, AI_SETUP_CACHE_MS, AI_USAGE_RETRY_MS, type AiCopyFlow, type AiKeySource, type AiProvider, type AiStep } from "@/shared/lib/constants/ai";
import { hasSharedSecret, unlockSecret } from "@/shared/lib/ai/secretBox";

/**
 * AI Setup at run time: the keys and chains saved on Settings → AI Setup, which
 * key is usable on THIS server, and the chain runner every AI call goes through.
 *
 * Rest, gap and day / month counts are shared by every server in ai_key_usage on
 * the cloud DB (owner, 2026-10-23 — memory limited nothing on Vercel or on a till
 * that restarts daily): one read per pick, one atomic claim per call. Free keys take turns (least recently
 * used first, each after its own gap); a paid key is used only with Premium on
 * and no free key ready. A failing key rests — limitRestSeconds after a 429,
 * failRestSeconds after anything else — and the next key is tried.
 */

export type AiKeyConfig = {
    id: number;
    name: string;
    provider: AiProvider;
    model: string;
    source: AiKeySource;
    envName: string | null;
    secretEnc: string | null;
    keyHint: string;
    canPhoto: boolean;
    canSearch: boolean;
    paid: boolean;
    active: boolean;
    /** yyyy-mm-dd or null. */
    validTill: string | null;
    gapSeconds: number;
    dailyLimit: number | null;
    monthlyLimit: number | null;
    limitRestSeconds: number;
    failRestSeconds: number;
    timeoutSeconds: number;
    retries: number;
};

/** chains[use][step] = key ids in order. */
export type AiChains = Record<string, Partial<Record<AiStep, number[]>>>;

// ── Saved setup, cached (one DB read per AI_SETUP_CACHE_MS per server) ─────────

/** copyFlow = the option every product page opens on (OrgDefaults.aiCopyFlow); photoCheck = Verified's Photo AI (aiPhotoCheck). */
export type AiSetup = { keys: AiKeyConfig[]; chains: AiChains; copyFlow: AiCopyFlow; photoCheck: boolean };
let setupCache: (AiSetup & { at: number }) | null = null;

export function invalidateAiSetup() {
    setupCache = null;
}

export async function loadAiSetup(): Promise<AiSetup> {
    if (setupCache && Date.now() - setupCache.at < AI_SETUP_CACHE_MS) return setupCache;
    const [rows, steps, org] = await Promise.all([
        prisma.aiKey.findMany({ orderBy: { id: "asc" } }),
        prisma.aiChainStep.findMany({ orderBy: [{ use: "asc" }, { step: "asc" }, { position: "asc" }], select: { use: true, step: true, keyId: true } }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { aiCopyFlow: true, aiPhotoCheck: true } }),
    ]);
    const keys: AiKeyConfig[] = rows.map((r) => ({
        id: r.id, name: r.name, provider: r.provider as AiProvider, model: r.model, source: r.source as AiKeySource,
        envName: r.envName, secretEnc: r.secretEnc, keyHint: r.keyHint,
        canPhoto: r.canPhoto, canSearch: r.canSearch, paid: r.paid, active: r.active,
        validTill: r.validTill ? r.validTill.toISOString().slice(0, 10) : null,
        gapSeconds: r.gapSeconds, dailyLimit: r.dailyLimit, monthlyLimit: r.monthlyLimit, limitRestSeconds: r.limitRestSeconds,
        failRestSeconds: r.failRestSeconds, timeoutSeconds: r.timeoutSeconds, retries: r.retries,
    }));
    const chains: AiChains = {};
    for (const s of steps) ((chains[s.use] ??= {})[s.step as AiStep] ??= []).push(s.keyId);
    const copyFlow = AI_COPY_FLOWS.find((f) => f.value === org?.aiCopyFlow)?.value ?? AI_DEFAULT_COPY_FLOW;
    setupCache = { at: Date.now(), keys, chains, copyFlow, photoCheck: org?.aiPhotoCheck ?? false };
    return setupCache;
}

// ── Is this key usable here? ──────────────────────────────────────────────────

const providerReady = (p: AiProvider) => aiProviderInfo(p)?.ready ?? false;

/** The actual key on this server, or null. */
export function keyValue(k: AiKeyConfig): string | null {
    if (k.source === "env") return (k.envName && process.env[k.envName]?.trim()) || null;
    return k.secretEnc && hasSharedSecret() ? unlockSecret(k.secretEnc, "shared") : null;
}

/** Why this key cannot be used on this server (settings, not rest) — null = usable. */
export function whyNotUsable(k: AiKeyConfig): string | null {
    if (!k.active) return "Turned off";
    if (k.validTill && k.validTill < businessTodayIso()) return "Offer ended";
    if (!providerReady(k.provider)) return "Provider not built in yet";
    if (k.source === "env") return k.envName && process.env[k.envName]?.trim() ? null : `${k.envName ?? "Variable"} is not set here`;
    if (!k.secretEnc) return "No key saved";
    if (!hasSharedSecret()) return "AI_KEY_SECRET is not set here";
    if (!keyValue(k)) return "Saved with another AI_KEY_SECRET";
    return null;
}

// ── Run-time state, shared on the cloud database ──────────────────────────────

/** One key's use, as every server sees it (ai_key_usage). Times in ms; 0 = never. */
type KeyState = { callsToday: number; callsMonth: number; lastUsed: number; restUntil: number; lastOkAt: number; lastError: string; lastErrorAt: number };
const NO_USE: KeyState = { callsToday: 0, callsMonth: 0, lastUsed: 0, restUntil: 0, lastOkAt: 0, lastError: "", lastErrorAt: 0 };

const ms = (d: Date | null) => d?.getTime() ?? 0;

/** A usage-table hiccup must not stop AI: the call goes ahead uncounted, said once per minute. */
let warnedAt = 0;
function usageDown(e: unknown) {
    if (Date.now() - warnedAt < 60_000) return;
    warnedAt = Date.now();
    console.warn(`[aiKeys] ai_key_usage unreachable — calls go ahead uncounted: ${e instanceof Error ? e.message : String(e)}`);
}

/** The keys' shared use — one read for the whole list. */
async function statesOf(ids: number[]): Promise<Map<number, KeyState>> {
    const out = new Map<number, KeyState>();
    if (ids.length === 0) return out;
    const day = businessTodayIso();
    try {
        const rows = await prismaLive.aiKeyUsage.findMany({ where: { keyId: { in: ids } } });
        for (const r of rows) {
            out.set(r.keyId, {
                callsToday: r.day === day ? r.callsToday : 0,
                callsMonth: r.month === day.slice(0, 7) ? r.callsMonth : 0,
                lastUsed: ms(r.lastUsedAt), restUntil: ms(r.restUntil),
                lastOkAt: ms(r.lastOkAt), lastError: r.lastError ?? "", lastErrorAt: ms(r.lastErrorAt),
            });
        }
    } catch (e) {
        usageDown(e);
    }
    return out;
}

/** What the setup page shows per key: the shared counts, every server together. Times in ms. */
export type KeyUsage = {
    callsToday: number;
    callsMonth: number;
    lastUsedAt: number | null;
    restingUntil: number | null;
    lastOkAt: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
};

export async function keyUsages(ids: number[]): Promise<Map<number, KeyUsage>> {
    const states = await statesOf(ids);
    return new Map(ids.map((id): [number, KeyUsage] => {
        const s = states.get(id) ?? NO_USE;
        return [id, {
            callsToday: s.callsToday,
            callsMonth: s.callsMonth,
            lastUsedAt: s.lastUsed || null,
            restingUntil: s.restUntil > Date.now() ? s.restUntil : null,
            lastOkAt: s.lastOkAt || null,
            lastError: s.lastError || null,
            lastErrorAt: s.lastErrorAt || null,
        }];
    }));
}

const resting = (s: KeyState) => s.restUntil > Date.now();
const overLimit = (k: AiKeyConfig, s: KeyState) =>
    (k.dailyLimit != null && s.callsToday >= k.dailyLimit)
    || (k.monthlyLimit != null && s.callsMonth >= k.monthlyLimit);
/** ms until this key's gap has passed (0 = ready). */
const gapLeft = (k: AiKeyConfig, s: KeyState) => Math.max(0, s.lastUsed + k.gapSeconds * 1000 - Date.now());

/**
 * Take this key for one call, or not: in ONE statement, only if it is not resting,
 * its gap has passed and its day / month limit is not used up — and the call is
 * counted there and then. Two servers asking at once cannot both get it.
 */
async function claimKey(k: AiKeyConfig): Promise<boolean> {
    const day = businessTodayIso();
    const month = day.slice(0, 7);
    const now = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
    try {
        const rows = await prismaLive.$queryRaw<{ keyId: number }[]>`
            INSERT INTO "ai_key_usage" AS u ("keyId", "day", "callsToday", "month", "callsMonth", "lastUsedAt", "updatedAt")
            VALUES (${k.id}, ${day}, 1, ${month}, 1, ${now}, ${now})
            ON CONFLICT ("keyId") DO UPDATE SET
                "callsToday" = CASE WHEN u."day" = EXCLUDED."day" THEN u."callsToday" + 1 ELSE 1 END,
                "day" = EXCLUDED."day",
                "callsMonth" = CASE WHEN u."month" = EXCLUDED."month" THEN u."callsMonth" + 1 ELSE 1 END,
                "month" = EXCLUDED."month",
                "lastUsedAt" = EXCLUDED."lastUsedAt",
                "updatedAt" = EXCLUDED."updatedAt"
            WHERE (u."restUntil" IS NULL OR u."restUntil" <= ${now})
              AND (${k.gapSeconds}::int = 0 OR u."lastUsedAt" IS NULL OR u."lastUsedAt" <= ${now} - make_interval(secs => ${k.gapSeconds}::int))
              AND (${k.dailyLimit}::int IS NULL OR u."day" <> EXCLUDED."day" OR u."callsToday" < ${k.dailyLimit}::int)
              AND (${k.monthlyLimit}::int IS NULL OR u."month" <> EXCLUDED."month" OR u."callsMonth" < ${k.monthlyLimit}::int)
            RETURNING "keyId"`;
        return rows.length > 0;
    } catch (e) {
        usageDown(e);
        return true;
    }
}

async function noteFailure(k: AiKeyConfig, e: unknown) {
    const status = aiStatus(e);
    try {
        await prismaLive.aiKeyUsage.updateMany({
            where: { keyId: k.id },
            data: {
                restUntil: new Date(Date.now() + (status === 429 ? k.limitRestSeconds : k.failRestSeconds) * 1000),
                lastError: aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 200),
                lastErrorAt: new Date(),
            },
        });
    } catch (err) {
        usageDown(err);
    }
}

async function noteSuccess(k: AiKeyConfig) {
    try {
        // restUntil cleared: a parallel call may have marked it
        await prismaLive.aiKeyUsage.updateMany({ where: { keyId: k.id }, data: { restUntil: null, lastOkAt: new Date() } });
    } catch (e) {
        usageDown(e);
    }
}

/** The key's usage row goes with the key (no relation — see AiKeyUsage). */
export async function forgetKeyUsage(id: number) {
    try {
        await prismaLive.aiKeyUsage.deleteMany({ where: { keyId: id } });
    } catch (e) {
        usageDown(e);
    }
}

/**
 * The Test button's call, under the same gates as a real one: null = it may go
 * (and is counted now, so the next call waits its gap); otherwise why not yet.
 */
export async function claimTestCall(k: AiKeyConfig): Promise<string | null> {
    const s = (await statesOf([k.id])).get(k.id) ?? NO_USE;
    const secs = (n: number) => `${Math.ceil(n / 1000)} s`;
    if (resting(s)) return `Resting after a failure or limit hit — ${secs(s.restUntil - Date.now())} more`;
    if (k.dailyLimit != null && s.callsToday >= k.dailyLimit) return `Today's ${k.dailyLimit} calls are used up`;
    if (k.monthlyLimit != null && s.callsMonth >= k.monthlyLimit) return `This month's ${k.monthlyLimit} calls are used up`;
    if (gapLeft(k, s) > 0) return `Wait ${secs(gapLeft(k, s))} — last call was ${secs(Date.now() - s.lastUsed)} ago`;
    return (await claimKey(k)) ? null : "Another counter or the website just used this key — try again in a moment";
}

/** After the Test call: success clears a rest, a key failure starts one — as in runChain. */
export async function noteTestResult(k: AiKeyConfig, e?: unknown) {
    if (e === undefined) await noteSuccess(k);
    else if (isKeyFailure(e)) await noteFailure(k, e);
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** Premium off and every regular key is resting or used up — say so, never pay. */
export class AiRegularKeysOutError extends Error {
    constructor(onlyPaid = false) {
        super(onlyPaid
            ? "This AI job has only paid keys — turn on Premium API, or add a free key on Settings → AI Setup."
            : "Regular keys are used up for now — turn on Premium API, or try again later.");
        this.name = "AiRegularKeysOutError";
    }
}

export class AiKeysExhaustedError extends Error {
    constructor() {
        super("Every AI key is resting after a failure (busy, too slow, blocked or out of credit) — try again in a few minutes.");
        this.name = "AiKeysExhaustedError";
    }
}

/** The step has no key that works on this server at all. */
export class AiNoKeyError extends Error {
    constructor() {
        super("AI is not set up here — add a key on Settings → AI Setup.");
        this.name = "AiNoKeyError";
    }
}

/** The provider's HTTP status, looking inside the SDK's retry wrapper. */
export function aiStatus(e: unknown): number | undefined {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** The provider's reason in staff words — 402 / 429 / 403 mean the key, not the request. */
export function aiErrorMessage(e: unknown): string | null {
    if (e instanceof AiKeysExhaustedError || e instanceof AiRegularKeysOutError || e instanceof AiNoKeyError) return e.message;
    if (isTimeout(e)) return "The AI took too long — try again.";
    const status = aiStatus(e);
    if (status === 402) return "AI credit is used up — top up the project, or use a free-tier key.";
    if (status === 429) return "AI limit reached for now — wait a minute and try again.";
    if (status === 400 || status === 401 || status === 403) return "The AI provider refused the key — check it on Settings → AI Setup.";
    if (status === 500 || status === 503) return "The AI provider is busy — try again.";
    return null;
}

const KEY_FAULTS = new Set([400, 401, 402, 403, 429, 500, 503]);
/** About the key (refused, out of credit, at its limit, busy, too slow), not the request. */
export const isKeyFailure = (e: unknown) => KEY_FAULTS.has(aiStatus(e) ?? 0) || isTimeout(e);

// ── The chain runner ──────────────────────────────────────────────────────────

export type ChainOpts = {
    use: string;
    step: AiStep;
    /** Paid keys may be used (staff switched "Use Premium API" on). */
    premium: boolean;
    /** Bulk: wait for a free key's gap instead of taking a paid key. */
    wait?: boolean;
};

const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

/** Keys of this step usable here (settings only — rest and gap aside), in chain order. */
async function chainKeys({ use, step, premium }: ChainOpts): Promise<AiKeyConfig[]> {
    const { keys, chains } = await loadAiSetup();
    const byId = new Map(keys.map((k) => [k.id, k]));
    return (chains[use]?.[step] ?? [])
        .map((id) => byId.get(id))
        .filter((k): k is AiKeyConfig => !!k && !whyNotUsable(k) && (premium || !k.paid));
}

/** The step has at least one key that works on this server. */
export async function stepHasKey(opts: ChainOpts): Promise<boolean> {
    return (await chainKeys(opts)).length > 0;
}

/**
 * Run `fn` on the first key of this step that is ready, moving down the chain
 * on a key failure. Free keys past their gap first (least recently used), then
 * paid keys in chain order. Re-read after every wait, so parallel calls queue
 * for the keys in turn and none slips to a paid key needlessly.
 */
export async function runChain<T>(
    opts: ChainOpts,
    fn: (key: AiKeyConfig, apiKey: string, signal: AbortSignal) => Promise<T>,
): Promise<{ result: T; key: AiKeyConfig }> {
    const all = await chainKeys(opts);
    if (all.length === 0) {
        if (opts.premium) throw new AiNoKeyError();
        // No free key in the chain at all is not "used up" — say what is actually missing.
        throw new AiRegularKeysOutError((await chainKeys({ ...opts, premium: true })).length > 0);
    }
    // Premium off has nothing else it may use, so it waits for a free key too.
    const mayWait = opts.wait || !opts.premium;

    for (;;) {
        const states = await statesOf(all.map((k) => k.id));
        const st = (k: AiKeyConfig) => states.get(k.id) ?? NO_USE;
        const left = (k: AiKeyConfig) => gapLeft(k, st(k));
        const live = all.filter((k) => !resting(st(k)) && !overLimit(k, st(k)));
        const free = live.filter((k) => !k.paid);
        const readyFree = free.filter((k) => left(k) === 0)
            .sort((a, b) => st(a).lastUsed - st(b).lastUsed || all.indexOf(a) - all.indexOf(b));
        const readyPaid = live.filter((k) => k.paid && left(k) === 0);
        // Wait for a free key rather than pay, when allowed; wait for anything rather than fail.
        const waitOn = mayWait && readyFree.length === 0 && free.length ? free
            : readyFree.length + readyPaid.length === 0 ? live : [];
        if (waitOn.length) {
            // Each wait re-reads the shared rows, so not less than half a second.
            await sleep(Math.max(AI_USAGE_RETRY_MS, Math.min(...waitOn.map(left))));
            continue;
        }
        const order = [...readyFree, ...readyPaid];
        if (order.length === 0) break;

        let claimedAny = false;
        for (const key of order) {
            const apiKey = keyValue(key);
            if (!apiKey) continue;
            // Another server may have taken it since the read: try the next one.
            if (!(await claimKey(key))) continue;
            claimedAny = true;
            for (let attempt = 0; ; attempt++) {
                try {
                    const result = await fn(key, apiKey, AbortSignal.timeout(key.timeoutSeconds * 1000));
                    await noteSuccess(key);
                    return { result, key };
                } catch (e) {
                    if (!isKeyFailure(e)) throw e; // about this request, not the key
                    if (attempt < key.retries && aiStatus(e) !== 429) continue;
                    console.warn(`[aiKeys] ${opts.use}/${opts.step}: "${key.name}" failed (${aiStatus(e) ?? "timeout"}), trying the next key`);
                    await noteFailure(key, e);
                    break;
                }
            }
        }
        // Every ready key was taken by another server in between: read again and queue.
        if (!claimedAny) {
            await sleep(AI_USAGE_RETRY_MS);
            continue;
        }
        break;
    }
    throw opts.premium ? new AiKeysExhaustedError() : new AiRegularKeysOutError();
}

// ── Provider call ─────────────────────────────────────────────────────────────

/** The provider's model and its own web-search tool, if it has one. */
function modelOf(key: AiKeyConfig, apiKey: string): { model: LanguageModel; searchTools?: ToolSet } {
    const info = aiProviderInfo(key.provider);
    switch (key.provider) {
        case "gemini": {
            const google = createGoogleGenerativeAI({ apiKey });
            return { model: google(key.model), searchTools: { google_search: google.tools.googleSearch({}) } };
        }
        case "openai": {
            const openai = createOpenAI({ apiKey });
            // Cast: @ai-sdk/openai pulls a newer provider-utils than `ai` (two copies in the lockfile), so the
            // tool's schema type differs only by package copy. Drop the cast after `pnpm dedupe`.
            return { model: openai(key.model), searchTools: { web_search: openai.tools.webSearch({}) } as unknown as ToolSet };
        }
        case "claude": {
            const anthropic = createAnthropic({ apiKey });
            return { model: anthropic(key.model), searchTools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) } as unknown as ToolSet }; // same cast as openai
        }
        default: {
            if (!info?.baseURL) throw new Error(`${key.provider} is not an AI model — it is a web tool`);
            // Perplexity searches on every call by itself; the others have no search tool.
            return { model: createOpenAICompatible({ name: key.provider, baseURL: info.baseURL, apiKey })(key.model), searchTools: undefined };
        }
    }
}

/**
 * One plain call on this key. `search` = with web search: the provider's own
 * tool, or — for a model without one — the Web search keys (aiWeb.ts) run on
 * `searchQuery` first and the pages go into the prompt.
 */
export async function callModel(
    key: AiKeyConfig,
    apiKey: string,
    messages: ModelMessage[],
    opts: { search?: boolean; searchQuery?: string; signal?: AbortSignal } = {},
) {
    const { model, searchTools } = modelOf(key, apiKey);
    const native = aiProviderInfo(key.provider)?.nativeSearch;
    if (opts.search && !native) {
        const { webSearch, pagesForPrompt } = await import("@/shared/lib/ai/aiWeb");
        const query = opts.searchQuery ?? lastText(messages).slice(0, 300);
        messages = [{ role: "user", content: pagesForPrompt(await webSearch(query)) }, ...messages];
    }
    return generateText({
        model,
        tools: opts.search && native ? searchTools : undefined,
        messages,
        maxRetries: 0, // the chain moves on, or retries per the key's own setting
        abortSignal: opts.signal,
    });
}

/** The last user message's text, for a search query when the caller gave none. */
function lastText(messages: ModelMessage[]): string {
    const c = messages.at(-1)?.content;
    if (typeof c === "string") return c;
    return (Array.isArray(c) ? c : []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
}
