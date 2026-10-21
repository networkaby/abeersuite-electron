// AI settings. Which keys and models each AI job uses is chosen on Settings →
// AI Setup (ai_keys / ai_chain_steps tables, src/shared/lib/ai/aiKeys.ts); the
// lists below are what the page offers and the defaults a new key starts with.

/** Products sent to the AI per bulk step — small so the free tier's rate limit holds. */
export const AI_BULK_BATCH_SIZE = 5;

/** How many highlight bullets the Flipkart-style copy carries. */
export const AI_HIGHLIGHT_COUNT = { min: 4, max: 7 } as const;


/** Online search modes. "When it helps" = the first (photo) call says whether
 *  a second, searched call would add anything (owner settled 2026-10-19). */
export const AI_SEARCH_MODES = [
    { value: "off", label: "Off" },
    { value: "auto", label: "When it helps" },
    { value: "always", label: "Always" },
] as const;
export type AiSearchMode = (typeof AI_SEARCH_MODES)[number]["value"];
export const AI_DEFAULT_SEARCH_MODE: AiSearchMode = "auto";

/** AuditLog.entityType of the finished A/B search trial's picks (2026-10-19). Nothing
 *  writes it any more; the old rows stay hidden from the Recycle Bin and activity feed. */
export const AI_COPY_TEST_ENTITY = "AI_COPY_TEST";

/** How long a server keeps the saved AI Setup before reading it again (aiKeys.ts). */
export const AI_SETUP_CACHE_MS = 60_000;

/** Settings a new key starts with (seconds). Paid keys need no safety gap. */
export const AI_KEY_DEFAULTS = {
    gapSeconds: { free: 10, paid: 0 },
    limitRestSeconds: 120,
    failRestSeconds: 30 * 60,
    timeoutSeconds: 150, // drafts took 40–108 s under load (owner, 2026-10-19)
    retries: 0,
} as const;

// ── AI Setup page (Settings → AI Setup) ──

/** Providers a key can belong to. */
export const AI_PROVIDERS = [
    { value: "gemini", label: "Google Gemini", ready: true },
    // Listed for later — no SDK package yet, so the page offers them disabled.
    { value: "openai", label: "OpenAI", ready: false },
    { value: "claude", label: "Anthropic Claude", ready: false },
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number]["value"];

/** Where the actual key lives. Every other setting is the same for all three
 *  (owner, 2026-10-21): db = pasted on the page, saved locked in the database,
 *  every counter and the website; env = only the .env variable NAME (the key is
 *  already in that .env — a release or Vercel); ini = pasted on the page, saved
 *  locked on this PC only (aiLocalKeys.ts), never in the database. */
export const AI_KEY_SOURCES = [
    { value: "db", label: "Saved here (all counters + website)" },
    { value: "env", label: ".env variable (release / Vercel)" },
    { value: "ini", label: "Counter .ini (this counter only)" },
] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number]["value"];

/** Steps an AI use can have. */
export const AI_STEPS = [
    { value: "draft", label: "Draft" },
    { value: "search", label: "Search" },
    { value: "polish", label: "Polish" },
] as const;
export type AiStep = (typeof AI_STEPS)[number]["value"];

/** Every place the app uses AI — listed in code; the page only picks keys.
 *  `needs` says which tick a key must carry to be offered for that step. */
export const AI_USES: readonly {
    key: string;
    label: string;
    description: string;
    steps: readonly { step: AiStep; needs?: "search" | "photo" }[];
}[] = [
    {
        key: "product_copy",
        label: "Product description",
        description: "E-Commerce → Products: writes the description and highlights from the name and photo.",
        steps: [{ step: "draft", needs: "photo" }, { step: "search", needs: "search" }, { step: "polish" }],
    },
];
