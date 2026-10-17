import "server-only";
import { APICallError, RetryError, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, AI_PRODUCT_COPY_MODEL } from "@/shared/lib/constants";
import { verifyFacts, type CitedFact } from "@/modules/ecommerce/lib/aiFactCheck";

// Flipkart-style, SEO-friendly product copy, spending search money only where
// it adds something:
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
    imageUrl?: string | null;
    /** Off = never run step 2, even when it would help. */
    search: boolean;
};

const copySchema = z.object({
    /** Flipkart-style SEO title — also the Online display name. */
    title: z.string().min(1),
    /** One sentence, ~150 characters — first line of the description (Google snippet). */
    summary: z.string().default(""),
    highlights: z.array(z.string().min(1)).min(1).max(10),
    description: z.string().min(1),
    howToUse: z.array(z.string().min(1)).max(8).default([]),
    warranty: z.string().default(""),
    specs: z.record(z.string(), z.string()).default({}),
    /** Facts left out because the model was not sure — staff "Please check". */
    unsure: z.array(z.string()).default([]),
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
};

const freeKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const searchKey = () => process.env.GOOGLE_AI_SEARCH_API_KEY;

export function isAiConfigured(): boolean {
    return !!freeKey();
}

const STRICT_RULES = [
    "STRICT RULE: say nothing false. State a fact only if it is in the product name, printed on the product or pack in the photo, given below as verified, or an official spec of this exact model you are certain of.",
    "If unsure (speed, chipset, part number, yield, OS support, compatibility, switch type, warranty), leave it out and list it in \"unsure\". Fewer true facts beat more doubtful ones.",
    "Without a photo, never state colour, design or what is in the box.",
    "For a consumable, spare or accessory (ink, toner, cartridge, RAM, adapter, battery, charger, cable, keyboard/screen part), give the exact compatible device models the manufacturer lists, in specs as \"Compatible Models\" and one highlight starting \"Works with\" — never a series name alone; if unsure, leave both out.",
];

// Flipkart's product page, as words: an SEO title, Highlights, a Description,
// Specifications led by the "General" group, and a Warranty line.
const OUTPUT_KEYS = [
    "Write like Flipkart's product pages, and SEO-friendly: words a customer would type in Google, used naturally — never keyword stuffing, no hype (\"best ever\", \"amazing\").",
    "Return ONLY a JSON object, no markdown fence, with exactly these keys:",
    '"title": Flipkart-style title, max 100 characters: Brand + Model name/number + product type, then key spec and colour/variant in brackets, e.g. "Crucial 8GB DDR4 3200 MHz Laptop RAM (CT8G4SFRA32A)" or "ANT ESPORTS MK3400 Pro V3 Wired Mechanical Gaming Keyboard (Red Switch, White)";',
    '"summary": ONE sentence under 160 characters naming brand, model and product type with the main benefit — used as the search-result snippet;',
    `"highlights": ${AI_HIGHLIGHT_COUNT.min}-${AI_HIGHLIGHT_COUNT.max} Flipkart-style highlights, each under 12 words, spec-first (e.g. "8 GB DDR4 RAM", "3200 MHz Speed"), most useful first;`,
    '"description": ONE string, 2 short paragraphs in simple English separated by a blank line: what it is and who it is for, then what makes it useful;',
    '"howToUse": 3-5 short steps for the customer (install / fit / refill / first use);',
    '"warranty": one line, e.g. "1 Year Manufacturer Warranty", or "" if unknown;',
    '"specs": object of label → plain-text value, Flipkart order: "In The Box", "Model Number", "Model Name", "Brand", "Colour", then the technical specs for this product type, last "Warranty Summary";',
    '"unsure": facts you left out because you were not sure;',
];

function productLines(p: ProductCopyInput): string[] {
    return [
        `Product name: ${p.name}`,
        p.brand ? `Brand: ${p.brand}` : "",
        p.category ? `Category: ${p.category}` : "",
    ].filter(Boolean);
}

function draftPrompt(p: ProductCopyInput, hasPhoto: boolean): string {
    return [
        "You write product listings for an Indian online shop.",
        ...productLines(p),
        hasPhoto ? "A photo is attached: read every word, number, code and logo printed on the product and pack." : "",
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
        `Report these facts for this EXACT model (never a look-alike), each with the URL of the page you read it on: ${[...draft.unsure, "compatible models (if a consumable or accessory)", "warranty"].join("; ")}.`,
        "Copy each value as the page writes it, kept short (under 80 characters; a model list may be longer). Use simple labels such as \"Page Yield\", \"Warranty Summary\", \"Compatible Models\", \"Cable Length\", \"OS Support\". For compatible models, use the manufacturer's own list when it has one. Skip any fact you did not read on a page.",
        'Return ONLY JSON: {"facts":[{"label": string, "value": string, "url": string}]}',
    ].join("\n");
}

function polishPrompt(p: ProductCopyInput, draft: Copy, facts: CitedFact[]): string {
    return [
        "Rewrite this shop listing, adding the verified facts below. Keep every fact already in the draft, and keep the colour / variant words of the draft title.",
        ...productLines(p),
        "Draft (from the product photo):",
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

/** Google's HTTP status, looking inside the SDK's retry wrapper. */
function aiStatus(e: unknown): number | undefined {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

/** Google's reason in staff words — 402 / 429 / 403 mean the key, not this product. */
export function aiErrorMessage(e: unknown): string | null {
    const status = aiStatus(e);
    if (status === 402) return "Gemini credit is used up — top up the AI Studio project, or use a free-tier key.";
    if (status === 429) return "Gemini limit reached for now — wait a minute and try again.";
    if (status === 400 || status === 403) return "Gemini refused the key — check GOOGLE_GENERATIVE_AI_API_KEY.";
    return null;
}

/** Free key first; the paid key takes over when the free daily cap answers 429. */
async function callFreeFirst(content: Part[]) {
    try {
        return await call(freeKey()!, content, false);
    } catch (e) {
        const paid = searchKey();
        if (aiStatus(e) !== 429 || !paid) throw e;
        return call(paid, content, false);
    }
}

/** Plain text in Flipkart's section order — the storefront shows it pre-wrapped. */
function assembleDescription(c: Copy): string {
    const parts = [
        c.summary.trim(),
        ["Highlights", ...c.highlights.map((h) => `• ${h}`)].join("\n"),
        ["Description", c.description.trim()].join("\n"),
    ];
    if (c.howToUse.length) parts.push(["How to Use", ...c.howToUse.map((s, i) => `${i + 1}. ${s}`)].join("\n"));
    if (c.warranty.trim()) parts.push(["Warranty", c.warranty.trim()].join("\n"));
    return parts.filter(Boolean).join("\n\n");
}

export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    const photo = p.imageUrl && /^https?:\/\//.test(p.imageUrl) ? new URL(p.imageUrl) : null;
    const draftParts: Part[] = [{ type: "text", text: draftPrompt(p, !!photo) }];
    if (photo) draftParts.push({ type: "file", data: photo, mediaType: "image" });

    const { searchWorthy, searchQuery, ...draft } = draftSchema.parse(parseJson((await callFreeFirst(draftParts)).text));

    let final: Copy = draft;
    let sources: ProductCopy["sources"] = [];
    let search: ProductCopy["search"];
    let searchError: string | undefined;
    const paidKey = searchKey();
    if (!p.search) search = "off";
    else if (!searchWorthy || !searchQuery.trim()) search = "not-needed";
    else if (!paidKey) search = "no-key";
    else {
        try {
            const found = await call(paidKey, [{ type: "text", text: searchPrompt(p, draft, searchQuery.trim()) }], true);
            const cited = factsSchema.parse(parseJson(found.text)).facts
                // A legal paragraph or a foreign-language page is not a spec value.
                .filter((f) => f.value.trim().length > 0 && (f.value.length <= 120 || /compatib/i.test(f.label)) && !/[^\x20-\x7E₹°×–—’“”]/.test(f.value))
                .map((f) => ({ ...f, label: /warrant/i.test(f.label) ? "Warranty Summary" : f.label.trim() }));
            const verified = await verifyFacts(cited);
            if (verified.facts.length === 0) {
                search = "no-sources";
            } else {
                const polished = copySchema.parse(parseJson((await callFreeFirst([{ type: "text", text: polishPrompt(p, draft, verified.facts) }])).text));
                // The photo decides the variant: draft title and photo-read
                // specs win; verified facts fill what the draft lacked.
                const verifiedSpecs = Object.fromEntries(verified.facts.map((f) => [f.label, f.value]));
                final = { ...polished, title: draft.title, specs: { ...polished.specs, ...verifiedSpecs, ...draft.specs } };
                sources = verified.urls.map((url) => ({ title: new URL(url).hostname.replace(/^www\./, ""), url }));
                search = "searched";
            }
        } catch (e) {
            console.warn("[aiProductCopy] search step failed, keeping the photo draft:", aiErrorMessage(e) ?? e);
            search = "failed";
            searchError = aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 160);
        }
    }

    // No blank values, and one row per label whatever its case.
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(final.specs)) {
        if (!v.trim()) continue;
        const same = Object.keys(specs).find((x) => x.toLowerCase() === k.toLowerCase());
        if (!same) specs[k] = v.trim();
    }
    final = { ...final, specs };

    return { ...final, sources, shopDescription: assembleDescription(final), search, ...(searchError ? { searchError } : {}) };
}
