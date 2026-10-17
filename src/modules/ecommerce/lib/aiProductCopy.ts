import "server-only";
import { APICallError, RetryError, generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, AI_PRODUCT_COPY_MODEL } from "@/shared/lib/constants";

// Flipkart-style product copy from name + photo, with Google Search grounding so
// specs come from real product pages, not the model's guess. Gemini rejects a
// response schema alongside the search tool, so the model returns JSON as text
// and zod checks it here.

export type ProductCopyInput = {
    name: string;
    brand?: string | null;
    category?: string | null;
    imageUrl?: string | null;
    /** Off = name + photo only (no search charge). */
    search: boolean;
};

const copySchema = z.object({
    title: z.string().min(1),
    highlights: z.array(z.string().min(1)).min(1).max(10),
    description: z.string().min(1),
    specs: z.record(z.string(), z.string()).default({}),
});

export type ProductCopy = z.infer<typeof copySchema> & {
    /** Pages the search grounded on — shown to staff so they can check. */
    sources: { title: string; url: string }[];
    /** Text assembled for InvProduct.shopDescription. */
    shopDescription: string;
    /** Search was asked for but Google refused it (free-tier key has no search quota). */
    searchSkipped: boolean;
};

export function isAiConfigured(): boolean {
    return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

function buildPrompt(p: ProductCopyInput): string {
    return [
        "You write product listings for an Indian online shop, in the style of Flipkart.",
        `Product name: ${p.name}`,
        p.brand ? `Brand: ${p.brand}` : null,
        p.category ? `Category: ${p.category}` : null,
        p.imageUrl ? "A photo of the product is attached; use it to confirm the model, colour and what is in the box." : null,
        p.search
            ? "Search the web for this exact product (official brand page, Flipkart, Amazon.in) and use only specs you find. If a spec is not found, leave it out — never guess numbers."
            : "Do not invent technical numbers you cannot see in the name or photo; leave such specs out.",
        // Customers buying a consumable search by their device, not the refill code.
        "If the product is a consumable, spare or accessory (ink, toner, cartridge, drum, ribbon, adapter, battery, charger, cable, keyboard/screen part), name the exact compatible device models (e.g. \"PIXMA G1010, G2012, G3010\") — only models the manufacturer officially lists for it, never a series name alone. Put them in specs as \"Compatible Models\" and in one highlight starting \"Works with\". If you are not sure of any model, leave both out.",
        "",
        "Return ONLY a JSON object, no markdown fence, with these keys:",
        '- "title": a clean customer-facing product title (brand + model + key variant).',
        `- "highlights": ${AI_HIGHLIGHT_COUNT.min}-${AI_HIGHLIGHT_COUNT.max} short bullet points, each under 12 words, most important first.`,
        '- "description": 2 short paragraphs in simple English, benefits first, no hype words like "best ever".',
        '- "specs": an object of label → value (e.g. "Brand", "Model Number", "Colour", "Warranty", "In the Box"). Values as plain text.',
    ].filter((l) => l !== null).join("\n");
}

function parseJson(text: string): unknown {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI reply had no JSON");
    return JSON.parse(text.slice(start, end + 1));
}

async function callModel(p: ProductCopyInput) {
    const content: ({ type: "text"; text: string } | { type: "file"; data: URL; mediaType: string })[] = [
        { type: "text", text: buildPrompt(p) },
    ];
    if (p.imageUrl && /^https?:\/\//.test(p.imageUrl)) content.push({ type: "file", data: new URL(p.imageUrl), mediaType: "image" });
    return generateText({
        model: google(AI_PRODUCT_COPY_MODEL),
        tools: p.search ? { google_search: google.tools.googleSearch({}) } : undefined,
        messages: [{ role: "user", content }],
        maxRetries: 1,
    });
}

/** Google's reason in staff words — 402 / 429 mean the key's billing, not this product. */
/** Google's HTTP status, looking inside the SDK's retry wrapper. */
function aiStatus(e: unknown): number | undefined {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

export function aiErrorMessage(e: unknown): string | null {
    const status = aiStatus(e);
    if (status === 402) return "Gemini credit is used up — top up the AI Studio project, or use a free-tier key.";
    if (status === 429) return "Gemini limit reached for now — wait a minute and try again, or turn off Search online.";
    if (status === 400 || status === 403) return "Gemini refused the key — check GOOGLE_GENERATIVE_AI_API_KEY.";
    return null;
}

export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    let searchSkipped = false;
    let result;
    try {
        result = await callModel(p);
    } catch (e) {
        // A free-tier key gets no Google Search quota (429) while plain calls
        // still work — write from name + photo rather than fail the product.
        if (!p.search || aiStatus(e) !== 429) throw e;
        searchSkipped = true;
        result = await callModel({ ...p, search: false });
    }

    const copy = copySchema.parse(parseJson(result.text));
    const sources = result.sources
        .flatMap((s) => (s.sourceType === "url" ? [{ title: s.title ?? s.url, url: s.url }] : []))
        .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i)
        .slice(0, 8);
    const shopDescription = [copy.highlights.map((h) => `• ${h}`).join("\n"), copy.description].join("\n\n");
    return { ...copy, sources, shopDescription, searchSkipped };
}
