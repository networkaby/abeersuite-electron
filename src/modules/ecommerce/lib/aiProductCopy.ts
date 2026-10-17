import "server-only";
import { APICallError, RetryError, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, AI_PRODUCT_COPY_MODEL } from "@/shared/lib/constants";

// Flipkart-style product copy in two steps, so search money is spent only
// where it adds something:
//  1. Draft  — name + photo on the FREE key (GOOGLE_GENERATIVE_AI_API_KEY;
//     falls over to the paid key when the free daily cap answers 429),
//     strict "nothing false" rule. The model also reports what it was unsure
//     of and whether a web search could fill that (exact model code known,
//     brand likely to have official / reputed pages).
//  2. Search — only when step 1 says it is worth it, on the PAID key
//     (GOOGLE_AI_SEARCH_API_KEY; free-tier keys get no Google Search quota).
//     Searches the exact codes, fills gaps only; photo facts always win.
// Any failure in step 2 keeps the step-1 draft. Gemini rejects a response
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
    title: z.string().min(1),
    highlights: z.array(z.string().min(1)).min(1).max(10),
    description: z.string().min(1),
    howToUse: z.array(z.string().min(1)).max(8).default([]),
    specs: z.record(z.string(), z.string()).default({}),
    /** Facts left out because the model was not sure — staff "Please check". */
    unsure: z.array(z.string()).default([]),
});
const draftSchema = copySchema.extend({
    searchWorthy: z.boolean().default(false),
    searchQuery: z.string().default(""),
});

type Copy = z.infer<typeof copySchema>;

export type ProductCopy = Copy & {
    /** Pages the search grounded on — shown to staff so they can check. */
    sources: { title: string; url: string }[];
    /** Text assembled for InvProduct.shopDescription. */
    shopDescription: string;
    /** "searched" = step 2 ran; otherwise why it did not. */
    search: "searched" | "not-needed" | "off" | "no-key" | "failed";
};

const freeKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const searchKey = () => process.env.GOOGLE_AI_SEARCH_API_KEY;

export function isAiConfigured(): boolean {
    return !!freeKey();
}

const STRICT_RULES = [
    "STRICT RULE: say nothing false. State a fact only if it is in the product name, printed on the product or pack in the photo, or an official spec of this exact model you are certain of.",
    "If unsure (speed, chipset, part number, yield, OS support, compatibility, switch type), leave it out and list it in \"unsure\". Fewer true facts beat more doubtful ones. No hype words.",
    "Without a photo, never state colour, design or what is in the box.",
    "For a consumable, spare or accessory (ink, toner, cartridge, RAM, adapter, battery, charger, cable, keyboard/screen part), give the exact compatible device models the manufacturer lists, in specs as \"Compatible Models\" and one highlight starting \"Works with\" — never a series name alone; if unsure, leave both out.",
];

const OUTPUT_KEYS = [
    "Return ONLY a JSON object, no markdown fence, with exactly these keys:",
    '"title": customer-facing title (brand + model + key variant);',
    `"highlights": ${AI_HIGHLIGHT_COUNT.min}-${AI_HIGHLIGHT_COUNT.max} bullets, each under 12 words, most useful first;`,
    '"description": ONE string, 2 short paragraphs in simple English separated by a blank line;',
    '"howToUse": 3-5 short steps for the customer (install / fit / refill / first use);',
    '"specs": object of label → plain-text value (Brand, Model Number, key technical specs, Warranty, In the Box);',
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
        "You write product listings for an Indian online shop, in the style of Flipkart.",
        ...productLines(p),
        hasPhoto ? "A photo is attached: read every word, number, code and logo printed on the product and pack." : "",
        ...STRICT_RULES,
        "",
        ...OUTPUT_KEYS,
        '"searchWorthy": true only if an exact model or part code is known AND this brand is likely to have an official page or listings on reputed sellers that would fill the "unsure" facts; false for unbranded or small brands, or when nothing important is unsure;',
        '"searchQuery": the exact search text to use (brand + exact model/part code), or "".',
    ].filter(Boolean).join("\n");
}

function searchPrompt(p: ProductCopyInput, draft: Copy, query: string): string {
    return [
        "Improve this Indian shop listing with a Google search. Search for: " + query,
        ...productLines(p),
        "Draft written from the product photo (its facts are correct — keep them):",
        JSON.stringify(draft),
        "Use the search ONLY to fill the \"unsure\" facts and missing specs from the manufacturer's site or reputed sellers (Flipkart, Amazon.in, big retailers) for this EXACT model.",
        "Never use specs of similar or look-alike products. If sources disagree, leave the fact out and keep it in \"unsure\". Where the draft and a source differ, the draft wins.",
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

function assembleDescription(c: Copy): string {
    const parts = [c.highlights.map((h) => `• ${h}`).join("\n"), c.description.trim()];
    if (c.howToUse.length) parts.push(["How to use:", ...c.howToUse.map((s, i) => `${i + 1}. ${s}`)].join("\n"));
    return parts.join("\n\n");
}

export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    const photo = p.imageUrl && /^https?:\/\//.test(p.imageUrl) ? new URL(p.imageUrl) : null;
    const draftParts: Part[] = [{ type: "text", text: draftPrompt(p, !!photo) }];
    if (photo) draftParts.push({ type: "file", data: photo, mediaType: "image" });

    const paidKey = searchKey();
    let draftReply;
    try {
        draftReply = await call(freeKey()!, draftParts, false);
    } catch (e) {
        // Free tier's daily cap per model — carry on with the paid key when there is one.
        if (aiStatus(e) !== 429 || !paidKey) throw e;
        draftReply = await call(paidKey, draftParts, false);
    }
    const draftRaw = draftSchema.parse(parseJson(draftReply.text));
    const { searchWorthy, searchQuery, ...draft } = draftRaw;

    let final: Copy = draft;
    let sources: ProductCopy["sources"] = [];
    let search: ProductCopy["search"];
    if (!p.search) search = "off";
    else if (!searchWorthy || !searchQuery.trim()) search = "not-needed";
    else if (!paidKey) search = "no-key";
    else {
        try {
            const r = await call(paidKey, [{ type: "text", text: searchPrompt(p, draft, searchQuery.trim()) }], true);
            const improved = copySchema.parse(parseJson(r.text));
            // Photo-read specs win over anything the search brought back.
            final = { ...improved, specs: { ...improved.specs, ...draft.specs } };
            sources = r.sources
                .flatMap((s) => (s.sourceType === "url" ? [{ title: s.title ?? s.url, url: s.url }] : []))
                .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i)
                .slice(0, 8);
            search = "searched";
        } catch (e) {
            console.warn("[aiProductCopy] search step failed, keeping the photo draft:", aiErrorMessage(e) ?? e);
            search = "failed";
        }
    }

    return { ...final, sources, shopDescription: assembleDescription(final), search };
}
