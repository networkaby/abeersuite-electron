import "server-only";
import { APICallError, RetryError, generateText, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { AI_PROVIDERS, AI_SETUP_CACHE_MS, type AiKeySource, type AiProvider, type AiStep } from "@/shared/lib/constants/ai";
import { hasSharedSecret, unlockSecret } from "@/shared/lib/ai/secretBox";
import { hasLocalKey, readLocalKey } from "@/shared/lib/ai/aiLocalKeys";

/**
 * AI Setup at run time: the keys and chains saved on Settings → AI Setup, which
 * key is usable on THIS server, and the chain runner every AI call goes through.
 *
 * Rest, gap and daily counts live in memory per server (owner, 2026-10-21): no DB
 * write per call; a restart forgets them. Free keys take turns (least recently
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
    limitRestSeconds: number;
    failRestSeconds: number;
    timeoutSeconds: number;
    retries: number;
};

/** chains[use][step] = key ids in order. */
export type AiChains = Record<string, Partial<Record<AiStep, number[]>>>;

// ── Saved setup, cached (one DB read per AI_SETUP_CACHE_MS per server) ─────────

let setupCache: { at: number; keys: AiKeyConfig[]; chains: AiChains } | null = null;

export function invalidateAiSetup() {
    setupCache = null;
}

export async function loadAiSetup(): Promise<{ keys: AiKeyConfig[]; chains: AiChains }> {
    if (setupCache && Date.now() - setupCache.at < AI_SETUP_CACHE_MS) return setupCache;
    const [rows, steps] = await Promise.all([
        prisma.aiKey.findMany({ orderBy: { id: "asc" } }),
        prisma.aiChainStep.findMany({ orderBy: [{ use: "asc" }, { step: "asc" }, { position: "asc" }], select: { use: true, step: true, keyId: true } }),
    ]);
    const keys: AiKeyConfig[] = rows.map((r) => ({
        id: r.id, name: r.name, provider: r.provider as AiProvider, model: r.model, source: r.source as AiKeySource,
        envName: r.envName, secretEnc: r.secretEnc, keyHint: r.keyHint,
        canPhoto: r.canPhoto, canSearch: r.canSearch, paid: r.paid, active: r.active,
        validTill: r.validTill ? r.validTill.toISOString().slice(0, 10) : null,
        gapSeconds: r.gapSeconds, dailyLimit: r.dailyLimit, limitRestSeconds: r.limitRestSeconds,
        failRestSeconds: r.failRestSeconds, timeoutSeconds: r.timeoutSeconds, retries: r.retries,
    }));
    const chains: AiChains = {};
    for (const s of steps) ((chains[s.use] ??= {})[s.step as AiStep] ??= []).push(s.keyId);
    setupCache = { at: Date.now(), keys, chains };
    return setupCache;
}

// ── Is this key usable here? ──────────────────────────────────────────────────

const localDay = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const providerReady = (p: AiProvider) => AI_PROVIDERS.find((x) => x.value === p)?.ready ?? false;

/** The actual key on this server, or null. */
export function keyValue(k: AiKeyConfig): string | null {
    if (k.source === "env") return (k.envName && process.env[k.envName]?.trim()) || null;
    if (k.source === "db") return k.secretEnc && hasSharedSecret() ? unlockSecret(k.secretEnc, "shared") : null;
    return readLocalKey(k.id);
}

/** Why this key cannot be used on this server (settings, not rest) — null = usable. */
export function whyNotUsable(k: AiKeyConfig): string | null {
    if (!k.active) return "Turned off";
    if (k.validTill && k.validTill < localDay()) return "Offer ended";
    if (!providerReady(k.provider)) return "Provider not built in yet";
    if (k.source === "env" && !(k.envName && process.env[k.envName]?.trim())) return `${k.envName ?? "Variable"} is not set here`;
    if (k.source === "db") {
        if (!hasSharedSecret()) return "AI_KEY_SECRET is not set here";
        if (!keyValue(k)) return "Saved with another AI_KEY_SECRET";
    }
    if (k.source === "ini" && !hasLocalKey(k.id)) return "Saved on another PC";
    if (k.source === "ini" && !keyValue(k)) return "Could not unlock on this PC";
    return null;
}

// ── Run-time state, in memory ─────────────────────────────────────────────────

type KeyState = { lastUsed: number; restUntil: number; day: string; callsToday: number; lastOkAt: number; lastError: string; lastErrorAt: number };
const state = new Map<number, KeyState>();

function stateOf(id: number): KeyState {
    let s = state.get(id);
    if (!s) state.set(id, (s = { lastUsed: 0, restUntil: 0, day: localDay(), callsToday: 0, lastOkAt: 0, lastError: "", lastErrorAt: 0 }));
    if (s.day !== localDay()) Object.assign(s, { day: localDay(), callsToday: 0 });
    return s;
}

/** What the setup page shows per key: this server's counts since it started. */
export function keyUsage(id: number) {
    const s = stateOf(id);
    return {
        callsToday: s.callsToday,
        lastUsedAt: s.lastUsed || null,
        restingUntil: s.restUntil > Date.now() ? s.restUntil : null,
        lastOkAt: s.lastOkAt || null,
        lastError: s.lastError || null,
        lastErrorAt: s.lastErrorAt || null,
    };
}

const resting = (k: AiKeyConfig) => stateOf(k.id).restUntil > Date.now();
const overLimit = (k: AiKeyConfig) => k.dailyLimit != null && stateOf(k.id).callsToday >= k.dailyLimit;
/** ms until this key's gap has passed (0 = ready). */
const gapLeft = (k: AiKeyConfig) => Math.max(0, stateOf(k.id).lastUsed + k.gapSeconds * 1000 - Date.now());

function noteUse(k: AiKeyConfig) {
    const s = stateOf(k.id);
    s.lastUsed = Date.now();
    s.callsToday += 1;
}

function noteFailure(k: AiKeyConfig, e: unknown) {
    const s = stateOf(k.id);
    const status = aiStatus(e);
    s.restUntil = Date.now() + (status === 429 ? k.limitRestSeconds : k.failRestSeconds) * 1000;
    s.lastError = aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 200);
    s.lastErrorAt = Date.now();
}

function noteSuccess(k: AiKeyConfig) {
    const s = stateOf(k.id);
    s.restUntil = 0; // a parallel call may have marked it
    s.lastOkAt = Date.now();
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** Premium off and every regular key is resting or used up — say so, never pay. */
export class AiRegularKeysOutError extends Error {
    constructor() {
        super("Regular keys are used up for now — turn on Premium API, or try again later.");
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (all.length === 0) throw opts.premium ? new AiNoKeyError() : new AiRegularKeysOutError();
    // Premium off has nothing else it may use, so it waits for a free key too.
    const mayWait = opts.wait || !opts.premium;

    for (;;) {
        const live = all.filter((k) => !resting(k) && !overLimit(k));
        const free = live.filter((k) => !k.paid);
        const readyFree = free.filter((k) => gapLeft(k) === 0)
            .sort((a, b) => stateOf(a.id).lastUsed - stateOf(b.id).lastUsed || all.indexOf(a) - all.indexOf(b));
        const readyPaid = live.filter((k) => k.paid && gapLeft(k) === 0);
        // Wait for a free key rather than pay, when allowed; wait for anything rather than fail.
        const waitOn = mayWait && readyFree.length === 0 && free.length ? free
            : readyFree.length + readyPaid.length === 0 ? live : [];
        if (waitOn.length) {
            await sleep(Math.max(50, Math.min(...waitOn.map(gapLeft))));
            continue;
        }
        const order = [...readyFree, ...readyPaid];
        if (order.length === 0) break;

        for (const key of order) {
            const apiKey = keyValue(key);
            if (!apiKey) continue;
            noteUse(key);
            for (let attempt = 0; ; attempt++) {
                try {
                    const result = await fn(key, apiKey, AbortSignal.timeout(key.timeoutSeconds * 1000));
                    noteSuccess(key);
                    return { result, key };
                } catch (e) {
                    if (!isKeyFailure(e)) throw e; // about this request, not the key
                    if (attempt < key.retries && aiStatus(e) !== 429) continue;
                    console.warn(`[aiKeys] ${opts.use}/${opts.step}: "${key.name}" failed (${aiStatus(e) ?? "timeout"}), trying the next key`);
                    noteFailure(key, e);
                    break;
                }
            }
        }
        break;
    }
    throw opts.premium ? new AiKeysExhaustedError() : new AiRegularKeysOutError();
}

// ── Provider call ─────────────────────────────────────────────────────────────

/** One plain call on this key. `search` adds the provider's web-search tool (Gemini only). */
export function callModel(key: AiKeyConfig, apiKey: string, messages: ModelMessage[], opts: { search?: boolean; signal?: AbortSignal } = {}) {
    if (key.provider !== "gemini") throw new Error(`${key.provider} is not built in yet`);
    const google = createGoogleGenerativeAI({ apiKey });
    return generateText({
        model: google(key.model),
        tools: opts.search ? { google_search: google.tools.googleSearch({}) } : undefined,
        messages,
        maxRetries: 0, // the chain moves on, or retries per the key's own setting
        abortSignal: opts.signal,
    });
}
