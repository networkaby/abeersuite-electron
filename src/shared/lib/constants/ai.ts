// AI settings. Which keys and models each AI job uses is chosen on Settings →
// AI Setup (ai_keys / ai_chain_steps tables, src/shared/lib/ai/aiKeys.ts); the
// lists below are what the page offers and the defaults a new key starts with.

/** Products sent to the AI per bulk step — small so the free tier's rate limit holds. */
export const AI_BULK_BATCH_SIZE = 5;

/** How many highlight bullets the Flipkart-style copy carries. */
export const AI_HIGHLIGHT_COUNT = { min: 4, max: 7 } as const;


/** The two ways to write a product description (owner, 2026-10-21). Direct = one
 *  call from name + photo (the old model-search step added nothing and is gone).
 *  Verified = photo check, then the maker's / sellers' pages, then a write-up
 *  from those facts only — "no information is better than false information". */
export const AI_COPY_FLOWS = [
    { value: "direct", label: "Direct AI", hint: "One call from name and photo" },
    { value: "verified", label: "Verified", hint: "Checks the photo, reads the maker's page, writes only proven facts" },
] as const;
export type AiCopyFlow = (typeof AI_COPY_FLOWS)[number]["value"];
/** Fallback when OrgDefaults.aiCopyFlow is unreadable — the admin picks the real one on AI Setup. */
export const AI_DEFAULT_COPY_FLOW: AiCopyFlow = "verified";

/** Verified flow: pages read per product, how much of each is kept, and the
 *  e-commerce sites searched after the maker's own (domains). */
export const AI_VERIFIED_LIMITS = { pages: 4, pageChars: 9000, fetchMs: 15_000 } as const;
/** Verified photo suggestions: per page read, and in all (each one goes to the AI). `maxPx`: our
 *  Cloudinary photos go to the AI capped at this size — a full phone shot made the call time out. */
export const AI_PHOTO_LIMITS = { perPage: 4, total: 8, maxPx: 1600 } as const;
export const AI_SELLER_SITES = ["flipkart.com", "amazon.in", "reliancedigital.in", "croma.com"] as const;

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

/** Common models offered in the Model box's list. Only suggestions — staff can
 *  still type any model name; refresh when a provider ships new ones. */
export const AI_PROVIDER_MODELS: Partial<Record<AiProvider, readonly string[]>> = {
    gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    openai: ["gpt-5-mini", "gpt-5-nano", "gpt-5", "gpt-4.1-mini"],
    claude: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
    openrouter: ["google/gemini-2.5-flash", "openai/gpt-5-mini", "anthropic/claude-sonnet-5-5", "deepseek/deepseek-chat"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    mistral: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest", "pixtral-large-latest"],
    xai: ["grok-4", "grok-3-mini"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3"],
    perplexity: ["sonar", "sonar-pro", "sonar-reasoning"],
};

/** Highlights per page a web search hands to the model, and how much of a read page it keeps. */
export const AI_WEB_LIMITS = { results: 6, pageChars: 12_000 } as const;

/** Where the actual key lives. Every other setting is the same for both
 *  (owner, 2026-10-21): db = pasted on the page, saved locked in the database,
 *  every counter and the website; env = only the .env variable NAME (the key is
 *  already in that .env — a release or Vercel). A third "this PC only" kind was
 *  retired 2026-10-22 (migration 20261022200000_ai_retire_pc_keys). */
export const AI_KEY_SOURCES = [
    { value: "db", label: "Saved here (all counters + website)" },
    { value: "env", label: ".env variable (release / Vercel)" },
] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number]["value"];

/** Steps an AI use can have. */
export const AI_STEPS = [
    { value: "draft", label: "Draft" },
    { value: "search", label: "Search" },
    { value: "polish", label: "Polish" },
    { value: "read", label: "Read page" },
    { value: "check", label: "Check" },
    { value: "write", label: "Write" },
    { value: "photos", label: "Photos" },
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
    /** `chain` = the step edits another use's shared list (shown here, saved there). */
    steps: readonly { step: AiStep; needs?: AiNeed; chain?: string }[];
    /** No tab of its own — its lists are shown inside the jobs that use them. */
    hidden?: boolean;
    /** Shown as a section of another use's tab (that use's key). */
    tab?: string;
    /** Section heading when a tab holds more than one use. */
    section?: string;
}[] = [
    {
        key: "product_copy",
        label: "Product description",
        section: "Direct AI",
        description: "E-Commerce → Products, Direct AI: one call writes the description and highlights from the name and photo.",
        steps: [{ step: "draft", needs: "photo" }],
    },
    {
        key: "product_copy_verified",
        label: "Product description (verified)",
        tab: "product_copy",
        section: "Verified",
        description: "E-Commerce → Products, Verified, in run order: Check reads the photo and our data and picks the search words; Search finds the maker's and sellers' pages; our server opens each page itself and Read page tools are only the backup for a site that blocks it; Write uses only proven facts. An empty Check or Write borrows the Direct AI keys. Photos runs only when Photo AI is on (an extra AI call): the photo checklist, which photos to remove, and labels for the suggested photos; an empty Photos step borrows the Check keys. Off, the suggested photos still show, unlabelled, at no AI cost.",
        steps: [
            { step: "check", needs: "photo" },
            { step: "search", needs: "webSearch", chain: "web" },
            { step: "read", needs: "webRead", chain: "web" },
            { step: "write" },
            { step: "photos", needs: "photo" },
        ],
    },
    {
        key: "web",
        label: "Web search & page reading",
        description: "Shared by every AI job: a model without its own search finds pages here, and any job that must read a page fetches it here.",
        steps: [{ step: "search", needs: "webSearch" }, { step: "read", needs: "webRead" }],
        hidden: true,
    },
];
