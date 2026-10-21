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

/** Providers a key can belong to. `kind`: model = an AI that writes text;
 *  web = a web search / page-reading service (no model, no writing).
 *  `nativeSearch` = the model searches the web itself; any other model with
 *  "Can search online" ticked searches through the Web search keys (aiWeb.ts).
 *  `baseURL` = OpenAI-compatible endpoint. `hint` = model placeholder. */
export const AI_PROVIDERS = [
    { value: "gemini", label: "Google Gemini", kind: "model", ready: true, nativeSearch: true, hint: "gemini-2.5-flash" },
    { value: "openai", label: "OpenAI", kind: "model", ready: true, nativeSearch: true, hint: "gpt-5-mini" },
    { value: "claude", label: "Anthropic Claude", kind: "model", ready: true, nativeSearch: true, hint: "claude-sonnet-5-5" },
    { value: "groq", label: "Groq", kind: "model", ready: true, nativeSearch: false, hint: "llama-3.3-70b-versatile", baseURL: "https://api.groq.com/openai/v1" },
    { value: "openrouter", label: "OpenRouter", kind: "model", ready: true, nativeSearch: false, hint: "google/gemini-2.5-flash", baseURL: "https://openrouter.ai/api/v1" },
    { value: "deepseek", label: "DeepSeek", kind: "model", ready: true, nativeSearch: false, hint: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
    { value: "mistral", label: "Mistral", kind: "model", ready: true, nativeSearch: false, hint: "mistral-small-latest", baseURL: "https://api.mistral.ai/v1" },
    { value: "xai", label: "xAI Grok", kind: "model", ready: true, nativeSearch: false, hint: "grok-4", baseURL: "https://api.x.ai/v1" },
    { value: "together", label: "Together AI", kind: "model", ready: true, nativeSearch: false, hint: "meta-llama/Llama-3.3-70B-Instruct-Turbo", baseURL: "https://api.together.xyz/v1" },
    { value: "perplexity", label: "Perplexity", kind: "model", ready: true, nativeSearch: true, hint: "sonar", baseURL: "https://api.perplexity.ai" },
    // Web tools — searchable = finds pages for a query; readable = fetches a given page.
    { value: "exa", label: "Exa (web search)", kind: "web", ready: true, searchable: true, readable: true },
    { value: "tavily", label: "Tavily (web search)", kind: "web", ready: true, searchable: true, readable: true },
    { value: "firecrawl", label: "Firecrawl (search + scrape)", kind: "web", ready: true, searchable: true, readable: true },
    { value: "scrapedo", label: "Scrape.do (page scrape)", kind: "web", ready: true, searchable: false, readable: true },
] as const satisfies readonly {
    value: string; label: string; kind: "model" | "web"; ready: boolean;
    nativeSearch?: boolean; hint?: string; baseURL?: string; searchable?: boolean; readable?: boolean;
}[];
export type AiProvider = (typeof AI_PROVIDERS)[number]["value"];
export type AiProviderInfo = { value: AiProvider; label: string; kind: "model" | "web"; ready: boolean; nativeSearch?: boolean; hint?: string; baseURL?: string; searchable?: boolean; readable?: boolean };
export const aiProviderInfo = (p: string): AiProviderInfo | undefined => (AI_PROVIDERS as readonly AiProviderInfo[]).find((x) => x.value === p);
export const isWebProvider = (p: string) => aiProviderInfo(p)?.kind === "web";

/** Highlights per page a web search hands to the model, and how much of a read page it keeps. */
export const AI_WEB_LIMITS = { results: 6, pageChars: 12_000 } as const;

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
    { value: "read", label: "Read page" },
] as const;
export type AiStep = (typeof AI_STEPS)[number]["value"];

/** What a key must offer to sit in a step: a model tick, or a web tool's ability. */
export type AiNeed = "search" | "photo" | "webSearch" | "webRead";

/** Every place the app uses AI — listed in code; the page only picks keys.
 *  `needs` says which tick a key must carry to be offered for that step. */
export const AI_USES: readonly {
    key: string;
    label: string;
    description: string;
    steps: readonly { step: AiStep; needs?: AiNeed }[];
}[] = [
    {
        key: "product_copy",
        label: "Product description",
        description: "E-Commerce → Products: writes the description and highlights from the name and photo.",
        steps: [{ step: "draft", needs: "photo" }, { step: "search", needs: "search" }, { step: "polish" }],
    },
    {
        key: "web",
        label: "Web search & page reading",
        description: "Shared by every AI job: a model without its own search finds pages here, and any job that must read a page fetches it here.",
        steps: [{ step: "search", needs: "webSearch" }, { step: "read", needs: "webRead" }],
    },
];
