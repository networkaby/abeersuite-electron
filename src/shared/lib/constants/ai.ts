// AI product descriptions (E-Commerce → Products). Provider + model live here so
// a later comparison run (GPT / Claude / Perplexity) is a one-line change.
// Keys (.env / Vercel): GOOGLE_GENERATIVE_AI_API_KEY = free-tier project, writes
// every draft from name + photo. GOOGLE_AI_SEARCH_API_KEY = billed project, used
// only for the Google Search step when the draft says it would help. Leave the
// second one unset to stay at zero cost.

/** Gemini model used for product copy. The free tier caps each model per day
 *  (3.5-flash was 20 requests/day on 2026-10-17), so the draft step moves to
 *  the paid key once the free one answers 429. */
export const AI_PRODUCT_COPY_MODEL = "gemini-3.8-flash";

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

/** Longest one Gemini call may take before it is cut off (each step; maxRetries=1 can double it). */
export const AI_CALL_TIMEOUT_MS = 150_000; // drafts took 40–108 s under load (owner, 2026-10-19)

/** .env keys that write drafts and polish (owner, 2026-10-19). Every key but the
 *  last is a free-tier key, taken in turn (least recently used first) so one key
 *  is rarely hit twice inside a minute; the last is the paid key, used when no
 *  free key is ready. A failing key rests for AI_KEY_FAILURE_REST_MS (no day
 *  lockout); a 429 (per-minute limit) only for AI_RATE_LIMIT_REST_MS. The search
 *  step still uses GOOGLE_AI_SEARCH_API_KEY only. Replaced later by the AI setup page. */
export const AI_WRITE_KEY_CHAIN = [
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY1",
    "GOOGLE_GENERATIVE_AI_API_KEY2",
    "GOOGLE_GENERATIVE_AI_API_KEY3",
    "GOOGLE_GENERATIVE_AI_API_KEY4",
    "GOOGLE_GENERATIVE_AI_API_KEY5",
    "GOOGLE_AI_SEARCH_API_KEY",
] as const;

/** Safety gap between two calls on the same free key (owner, 2026-10-19: 10 s,
 *  well inside the free tier's per-minute limit). A call that cannot wait this
 *  long goes to the paid key instead. */
export const AI_FREE_KEY_GAP_MS = 10_000;

/** How long a key that answered 429 (per-minute limit) is left out. */
export const AI_RATE_LIMIT_REST_MS = 2 * 60_000;

/** How long a key is left out after any other failure (refused, 503, too slow) —
 *  owner, 2026-10-19: 30 min, then tried again; it mostly depends on server load. */
export const AI_KEY_FAILURE_REST_MS = 30 * 60_000;

// ── AI Setup page (Settings → AI Setup). UI preview only for now (2026-10-19):
//    nothing is saved yet; the tables, key lookup and Test call come next. ──

/** Providers a key can belong to. */
export const AI_PROVIDERS = [
    { value: "gemini", label: "Google Gemini" },
    { value: "openai", label: "OpenAI" },
    { value: "claude", label: "Anthropic Claude" },
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number]["value"];

/** Where the actual key lives. Every other setting is the same for all three
 *  (owner, 2026-10-19): db = pasted on the page, saved locked, every counter
 *  and the website; env = .env name, counters on a release that carries it and
 *  Vercel; ini = counter .ini name, that one counter only. */
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
