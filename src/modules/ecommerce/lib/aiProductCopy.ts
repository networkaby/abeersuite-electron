import "server-only";
import { generateText } from "ai";
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

export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    const content: ({ type: "text"; text: string } | { type: "image"; image: URL })[] = [
        { type: "text", text: buildPrompt(p) },
    ];
    if (p.imageUrl && /^https?:\/\//.test(p.imageUrl)) content.push({ type: "image", image: new URL(p.imageUrl) });

    const result = await generateText({
        model: google(AI_PRODUCT_COPY_MODEL),
        tools: p.search ? { google_search: google.tools.googleSearch({}) } : undefined,
        messages: [{ role: "user", content }],
        maxRetries: 1,
    });

    const copy = copySchema.parse(parseJson(result.text));
    const sources = result.sources
        .flatMap((s) => (s.sourceType === "url" ? [{ title: s.title ?? s.url, url: s.url }] : []))
        .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i)
        .slice(0, 8);
    const shopDescription = [copy.highlights.map((h) => `• ${h}`).join("\n"), copy.description].join("\n\n");
    return { ...copy, sources, shopDescription };
}
