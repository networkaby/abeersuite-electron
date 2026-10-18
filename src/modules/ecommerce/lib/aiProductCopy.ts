import "server-only";
import { APICallError, RetryError, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, AI_PRODUCT_COPY_MODEL, type AiSearchMode } from "@/shared/lib/constants/ai";
import { verifyFacts, type CitedFact } from "@/modules/ecommerce/lib/aiFactCheck";

// Flipkart-style, SEO-friendly product copy, spending search money only where
// it adds something. House style (owner, 2026-10-19): model + technical specs,
// compact and SEO-friendly with no filler; colour only when the office name
// has it; warranty always worded "Manufacturer Warranty" (label first, else
// the product's shop term); a compatibility guide for every product type —
// kept as its own list so a later bundle feature can use it.
//  1. Draft  — name + photo on the FREE key (GOOGLE_GENERATIVE_AI_API_KEY;
//     falls over to the paid key when the free daily cap answers 429), strict
//     "nothing false" rule. Also reports what it was unsure of and whether a
//     web search could fill that.
//  2. Search — only when step 1 says it helps, on the PAID key
//     (GOOGLE_AI_SEARCH_API_KEY; free-tier keys get no Google Search quota).
//     Asks for each missing fact WITH the page URL it was read on; the server
//     opens every URL and keeps a fact only if the page shows the value
//     (aiFactCheck.ts) — Gemini answers specs from memory and invents URLs.
//  3. Polish — only when step 2 verified something: rewrite the draft with
//     those facts, free key first. Photo facts and the title's variant win.
// Any failure after step 1 keeps the step-1 draft. Gemini rejects a response
// schema alongside the search tool, so replies are JSON text checked by zod.

export type ProductCopyInput = {
    name: string;
    brand?: string | null;
    category?: string | null;
    /** The product's warranty term (InvWarrantyTerm.durationDays) — used only when the label shows none. */
    shopWarrantyDays?: number | null;
    /** Gallery photos to send, already without the staff-skipped ones (photoMark.ts). */
    imageUrls: string[];
    /** off = never run step 2; auto = when the draft says it helps; always = every time (A/B test, 2026-10-19). */
    search: AiSearchMode;
};

// The model's JSON drifts run to run (a spec value as a list or number, an
// extra highlight, a paragraph array) — read it leniently instead of failing
// the product.
const text = (v: unknown): string =>
    Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).trim();
const textList = (max: number) => z.preprocess(
    (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(text).filter(Boolean).slice(0, max),
    z.array(z.string()),
);
const looseText = z.preprocess((v) => (Array.isArray(v) ? v.map(text).join("\n\n") : text(v)), z.string());

const copySchema = z.object({
    /** Flipkart-style SEO title — also the Online display name. */
    title: looseText.pipe(z.string().min(1)),
    /** One sentence, ~150 characters — first line of the description (Google snippet). */
    summary: looseText.default(""),
    highlights: textList(10).pipe(z.array(z.string()).min(1)),
    description: looseText.pipe(z.string().min(1)),
    howToUse: textList(8).default([]),
    warranty: looseText.default(""),
    specs: z.preprocess(
        (v) => (v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, text(x)]))
            : {}),
        z.record(z.string(), z.string()),
    ).default({}),
    /** Supporting products by kind — printers for an ink, CPUs / RAM for a motherboard. */
    compatibility: z.preprocess(
        (v) => (Array.isArray(v) ? v : []).flatMap((x) => {
            if (!x || typeof x !== "object") return [];
            const o = x as Record<string, unknown>;
            const models = (Array.isArray(o.models) ? o.models : [o.models]).map(text).filter(Boolean);
            const type = text(o.type);
            return type && models.length ? [{ type, models }] : [];
        }),
        z.array(z.object({ type: z.string(), models: z.array(z.string()) })),
    ).default([]),
    /** Facts left out because the model was not sure — staff "Please check". */
    unsure: textList(12).default([]),
});
const draftSchema = copySchema.extend({
    searchWorthy: z.boolean().default(false),
    searchQuery: z.string().default(""),
});
const factsSchema = z.object({
    facts: z.array(z.object({ label: z.string(), value: z.string(), url: z.string() })).default([]),
});

type Copy = z.infer<typeof copySchema>;

export type ProductCopy = Copy & {
    /** Pages whose content confirmed a fact — shown to staff so they can check. */
    sources: { title: string; url: string }[];
    /** Text assembled for InvProduct.shopDescription. */
    shopDescription: string;
    /** "searched" = verified facts were added; otherwise why not. */
    search: "searched" | "not-needed" | "off" | "no-key" | "failed" | "no-sources";
    /** Why the search step failed, in staff words — only with search "failed". */
    searchError?: string;
    /** Version A — the name-and-photo draft, only when search changed it (version B is the copy itself). */
    photoOnly?: Pick<ProductCopy, "title" | "summary" | "highlights" | "description" | "compatibility" | "howToUse" | "warranty" | "specs" | "unsure" | "shopDescription">;
    /** For the A/B test log: what this run cost and found. */
    stats: {
        mode: AiSearchMode;
        verifiedFacts: number;
        tokens: { draft: number; search: number; polish: number };
        draftKey: "free" | "paid";
        ms: number;
    };
};

const freeKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const searchKey = () => process.env.GOOGLE_AI_SEARCH_API_KEY;

export function isAiConfigured(): boolean {
    return !!freeKey();
}

const STRICT_RULES = [
    "STRICT RULE: say nothing false. State a fact only if it is in the product name, printed on the product or pack in the photo, given below as verified, or an official spec of this exact model you are certain of.",
    "If unsure (speed, chipset, part number, yield, OS support, compatibility, switch type), leave it out and list it in \"unsure\". Fewer true facts beat more doubtful ones.",
    "Colour: mention it only if the product name contains it — never from a photo or from memory. Never state design or what is in the box without a photo of the product itself.",
    "Compatibility: name exact model numbers only, never a series name alone; if unsure, leave it out.",
];

// A Flipkart-style page, compact: an SEO title, Highlights, a short
// Description, Compatible With, Specifications, and a Warranty line.
const OUTPUT_KEYS = [
    "Style: simple, compact, SEO-friendly — brand, model number, product type and key specs in the words a customer types into Google. Lead with model and technical specifications. No filler, no repetition, no hype (\"best ever\", \"amazing\"), no keyword stuffing. Do not shorten true facts to save space.",
    "Return ONLY a JSON object, no markdown fence, with exactly these keys:",
    '"title": max 100 characters: Brand + Model name/number + product type + key spec, a part code or spec in brackets, e.g. "Crucial 8GB DDR4 3200 MHz Laptop RAM (CT8G4SFRA32A)" or "HP 680 Black Original Ink Cartridge (F6V27AA)"; colour only if the product name has it;',
    '"summary": ONE sentence under 160 characters naming brand, model and product type with the main spec — used as the search-result snippet;',
    `"highlights": ${AI_HIGHLIGHT_COUNT.min}-${AI_HIGHLIGHT_COUNT.max} highlights, each under 12 words, spec-first (e.g. "8 GB DDR4 RAM", "3200 MHz Speed"), most useful first;`,
    '"description": ONE short paragraph in simple English: what it is, who it is for, what makes it useful — no line that only repeats the highlights;',
    '"compatibility": list of {"type": string, "models": string[]} guiding the customer to the products that go with this one, exact models only, e.g. ink/toner → {"type":"Printer","models":[...]}; printer → {"type":"Cartridge"/"Toner"/"Ink Refill","models":[part numbers]}; motherboard → {"type":"CPU","models":[socket + supported series]}, {"type":"RAM","models":["DDR5 up to 6000 MHz, max 128 GB"]}; RAM/SSD → the slot or interface it needs; [] if nothing certain;',
    '"howToUse": steps ONLY if printed on the product/label or given on the manufacturer website; otherwise [];',
    '"warranty": one line ending "Manufacturer Warranty", e.g. "3 Year Manufacturer Warranty" — the warranty printed on the label if any, else the shop warranty given above, else "";',
    '"specs": object of label → plain-text value, in this order: "Model Number", "Model Name", "Brand", then the technical specs for this product type, "Compatible Models" (if any), "In The Box" (only from a photo), last "Warranty Summary" (same as warranty);',
    '"unsure": facts you left out because you were not sure;',
];

function productLines(p: ProductCopyInput): string[] {
    return [
        `Product name: ${p.name}`,
        p.brand ? `Brand: ${p.brand}` : "",
        p.category ? `Category: ${p.category}` : "",
        p.shopWarrantyDays ? `Shop warranty (use only if no warranty is printed on the label): ${warrantyText(p.shopWarrantyDays)}` : "",
    ].filter(Boolean);
}

/** 365 → "1 Year", 180 → "6 Month", 15 → "15 Day". */
function warrantyText(days: number): string {
    if (days % 365 === 0) return `${days / 365} Year`;
    if (days % 30 === 0) return `${days / 30} Month`;
    return `${days} Day`;
}

function draftPrompt(p: ProductCopyInput, photoCount: number): string {
    return [
        "You write product listings for an Indian online shop.",
        ...productLines(p),
        photoCount > 0 ? [
            `${photoCount} photo${photoCount > 1 ? "s are" : " is"} attached. First decide what each one shows: the product itself, its box/pack, a label or spec sheet (back of box, warranty card), a promo/lifestyle picture (people, places, posters), or something that is not this product.`,
            "Read every word, number, code and logo printed on the product, box and labels — specs come only from those.",
            "A warranty printed on the box or label is the manufacturer warranty — use it. Promo pictures: ignore the people and background and treat their slogans as marketing, not specs. Ignore any photo that is not this product.",
        ].join("\n") : "",
        ...STRICT_RULES,
        "",
        ...OUTPUT_KEYS,
        '"searchWorthy": true only if an exact model or part code is known AND this brand is likely to have an official page or listings on reputed sellers that would fill the "unsure" facts; false for unbranded or small brands, or when nothing important is unsure;',
        '"searchQuery": the exact search text (brand + exact model/part code), or "".',
    ].filter(Boolean).join("\n");
}

// Asked as "read today's page and give its URL" — a plain spec question gets
// answered from memory with no search at all.
function searchPrompt(p: ProductCopyInput, draft: Copy, query: string): string {
    return [
        `Find the current official product page for "${query}" on the manufacturer's website — its India English site first (e.g. hp.com/in-en), else another English one — and its listing on Flipkart or Amazon.in. Read those pages today. English pages only.`,
        ...productLines(p),
        `Report these facts for this EXACT model (never a look-alike), each with the URL of the page you read it on: ${[...draft.unsure, "compatible products (printers / cartridges / CPUs / RAM etc. that go with it)", "how-to-use steps on the manufacturer page", ...(draft.warranty ? [] : ["manufacturer warranty"])].join("; ")}.`,
        "Copy each value as the page writes it, kept short (under 80 characters; a model list may be longer). Use simple labels such as \"Page Yield\", \"Warranty Summary\", \"Compatible Models\", \"Cable Length\", \"OS Support\". For compatible models, use the manufacturer's own list when it has one. Skip any fact you did not read on a page.",
        'Return ONLY JSON: {"facts":[{"label": string, "value": string, "url": string}]}',
    ].join("\n");
}

function polishPrompt(p: ProductCopyInput, draft: Copy, facts: CitedFact[]): string {
    return [
        "Rewrite this shop listing, adding the verified facts below. Keep every fact already in the draft, the model words of the draft title, and the draft warranty if it has one.",
        ...productLines(p),
        "Draft (from the product photos):",
        JSON.stringify(draft),
        "Verified facts (each read on a real web page):",
        JSON.stringify(facts.map(({ label, value }) => ({ label, value }))),
        'Drop from "unsure" anything the verified facts now answer.',
        ...STRICT_RULES,
        "",
        ...OUTPUT_KEYS,
    ].join("\n");
}

function parseJson(text: string): unknown {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI reply had no JSON");
    return JSON.parse(text.slice(start, end + 1));
}

type Part = { type: "text"; text: string } | { type: "file"; data: URL; mediaType: string };

function call(apiKey: string, content: Part[], withSearch: boolean) {
    const google = createGoogleGenerativeAI({ apiKey });
    return generateText({
        model: google(AI_PRODUCT_COPY_MODEL),
        tools: withSearch ? { google_search: google.tools.googleSearch({}) } : undefined,
        messages: [{ role: "user", content }],
        maxRetries: 1,
    });
}

/** The model answered, twice, with something that is not a usable listing. */
export class AiReplyError extends Error {
    constructor(cause: unknown) {
        super(`AI reply could not be read (${cause instanceof z.ZodError ? cause.issues.map((i) => i.path.join(".") || "reply").join(", ") : cause instanceof Error ? cause.message : "unknown"}) — press Generate again.`);
        this.name = "AiReplyError";
    }
}

/** Google's HTTP status, looking inside the SDK's retry wrapper. */
function aiStatus(e: unknown): number | undefined {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

/** Google's reason in staff words — 402 / 429 / 403 mean the key, not this product. */
export function aiErrorMessage(e: unknown): string | null {
    if (e instanceof AiReplyError) return e.message;
    const status = aiStatus(e);
    if (status === 402) return "Gemini credit is used up — top up the AI Studio project, or use a free-tier key.";
    if (status === 429) return "Gemini limit reached for now — wait a minute and try again.";
    if (status === 400 || status === 403) return "Gemini refused the key — check GOOGLE_GENERATIVE_AI_API_KEY.";
    return null;
}

/** Free key first; the paid key takes over when the free daily cap answers 429, or Google blocks the free project (403). */
async function callFreeFirst(content: Part[]) {
    try {
        return { reply: await call(freeKey()!, content, false), key: "free" as const };
    } catch (e) {
        const paid = searchKey();
        // 403 = Google blocked the free project (seen 2026-10-19), not this product.
        if ((aiStatus(e) !== 429 && aiStatus(e) !== 403) || !paid) throw e;
        return { reply: await call(paid, content, false), key: "paid" as const };
    }
}

const tokensOf = (r: { usage?: { totalTokens?: number } }) => r.usage?.totalTokens ?? 0;

/** No blank values, and one row per label whatever its case. */
function cleanSpecs(raw: Record<string, string>): Record<string, string> {
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (!v.trim()) continue;
        const same = Object.keys(specs).find((x) => x.toLowerCase() === k.toLowerCase());
        if (!same) specs[k] = v.trim();
    }
    return specs;
}

/** Plain text in Flipkart's section order — the storefront shows it pre-wrapped. */
function assembleDescription(c: Copy): string {
    const parts = [
        c.summary.trim(),
        ["Highlights", ...c.highlights.map((h) => `• ${h}`)].join("\n"),
        ["Description", c.description.trim()].join("\n"),
    ];
    if (c.compatibility.length) parts.push(["Compatible With", ...c.compatibility.map((x) => `• ${x.type}: ${x.models.join(", ")}`)].join("\n"));
    if (c.howToUse.length) parts.push(["How to Use", ...c.howToUse.map((s, i) => `${i + 1}. ${s}`)].join("\n"));
    if (c.warranty.trim()) parts.push(["Warranty", c.warranty.trim()].join("\n"));
    return parts.filter(Boolean).join("\n\n");
}

export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    const photos = p.imageUrls.filter((u) => /^https?:\/\//.test(u)).map((u) => new URL(u));
    const draftParts: Part[] = [{ type: "text", text: draftPrompt(p, photos.length) }];
    for (const photo of photos) draftParts.push({ type: "file", data: photo, mediaType: "image" });

    const started = Date.now();
    const tokens = { draft: 0, search: 0, polish: 0 };
    let draftKey: "free" | "paid" = "free";
    // One more try when the reply cannot be read at all (no JSON, no title…).
    const readDraft = async () => {
        const { reply, key } = await callFreeFirst(draftParts);
        tokens.draft += tokensOf(reply);
        draftKey = key;
        return draftSchema.parse(parseJson(reply.text));
    };
    let draftRaw;
    try {
        draftRaw = await readDraft();
    } catch (e) {
        if (aiStatus(e) !== undefined) throw e;
        try {
            draftRaw = await readDraft();
        } catch (again) {
            if (aiStatus(again) !== undefined) throw again;
            throw new AiReplyError(again);
        }
    }
    const { searchWorthy, searchQuery, ...draft } = draftRaw;

    let final: Copy = draft;
    let sources: ProductCopy["sources"] = [];
    let search: ProductCopy["search"];
    let searchError: string | undefined;
    let verifiedFacts = 0;
    const paidKey = searchKey();
    // "always" searches even when the draft says no — by the brand + name if it gave no query.
    const query = searchQuery.trim() || (p.search === "always" ? [p.brand, p.name].filter(Boolean).join(" ") : "");
    if (p.search === "off") search = "off";
    else if (p.search === "auto" && (!searchWorthy || !query)) search = "not-needed";
    else if (!paidKey) search = "no-key";
    else {
        try {
            const found = await call(paidKey, [{ type: "text", text: searchPrompt(p, draft, query) }], true);
            tokens.search += tokensOf(found);
            const cited = factsSchema.parse(parseJson(found.text)).facts
                // A legal paragraph or a foreign-language page is not a spec value.
                .filter((f) => f.value.trim().length > 0 && (f.value.length <= 120 || /compatib/i.test(f.label)) && !/[^\x20-\x7E₹°×–—’“”]/.test(f.value))
                .map((f) => ({ ...f, label: /warrant/i.test(f.label) ? "Warranty Summary" : f.label.trim() }));
            const verified = await verifyFacts(cited);
            verifiedFacts = verified.facts.length;
            if (verified.facts.length === 0) {
                search = "no-sources";
            } else {
                const { reply: polishReply } = await callFreeFirst([{ type: "text", text: polishPrompt(p, draft, verified.facts) }]);
                tokens.polish += tokensOf(polishReply);
                const polished = copySchema.parse(parseJson(polishReply.text));
                // The label decides: draft title, warranty and photo-read
                // specs win; verified facts fill what the draft lacked.
                const verifiedSpecs = Object.fromEntries(verified.facts.map((f) => [f.label, f.value]));
                final = { ...polished, title: draft.title, warranty: draft.warranty || polished.warranty, specs: { ...polished.specs, ...verifiedSpecs, ...draft.specs } };
                sources = verified.urls.map((url) => ({ title: new URL(url).hostname.replace(/^www\./, ""), url }));
                search = "searched";
            }
        } catch (e) {
            console.warn("[aiProductCopy] search step failed, keeping the photo draft:", aiErrorMessage(e) ?? e);
            search = "failed";
            searchError = aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 160);
        }
    }

    final = { ...final, specs: cleanSpecs(final.specs) };
    const photoDraft = { ...draft, specs: cleanSpecs(draft.specs) };
    const stats = { mode: p.search, verifiedFacts, tokens, draftKey, ms: Date.now() - started };

    return {
        ...final,
        sources,
        shopDescription: assembleDescription(final),
        search,
        ...(searchError ? { searchError } : {}),
        ...(search === "searched" ? { photoOnly: { ...photoDraft, shopDescription: assembleDescription(photoDraft) } } : {}),
        stats,
    };
}
