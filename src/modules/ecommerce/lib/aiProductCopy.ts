import "server-only";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, type AiCopyFlow, type AiStep } from "@/shared/lib/constants/ai";
import type { PhotoArrange, PhotoChecklist, PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";
import {
    AiKeysExhaustedError, AiNoKeyError, AiRegularKeysOutError, aiErrorMessage as keyErrorMessage, aiStatus,
    callModel, runChain, stepHasKey,
} from "@/shared/lib/ai/aiKeys";

// Flipkart-style, SEO-friendly product copy. House style (owner, 2026-10-19):
// model + technical specs, compact and SEO-friendly with no filler; colour only
// when the office name has it; a compatibility guide for every product type —
// kept as its own list so a later bundle feature can use it.
// Two flows (AI_COPY_FLOWS), each on its own keys from Settings → AI Setup:
//  · Direct AI (here) — one Draft call from name + photo, strict "nothing
//    false" rule. The old model-search + polish steps added nothing that
//    survived the page check (owner, 2026-10-21) and are gone.
//  · Verified (aiVerifiedCopy.ts) — photo check, the maker's / sellers' pages,
//    then a write-up from proven facts only. Shares the schema and prompts below.
// Warranty (owner, 2026-10-21): the description carries only the MAKER's term,
// worded as the maker's. Our own support period (the product's warranty term,
// office name, POS bill) never goes online as a "Manufacturer Warranty".
// Replies are JSON text checked by zod — lenient, since the model's JSON drifts.

export type ProductCopyInput = {
    name: string;
    brand?: string | null;
    category?: string | null;
    /** Gallery photos to send, already without the staff-skipped ones (photoMark.ts). */
    imageUrls: string[];
    /** Bulk run: wait for a free key's safety gap instead of taking the paid key. */
    bulk?: boolean;
    /** Staff switched "Use Premium API" on. Off = regular (free) keys only — nothing is spent unknowingly. */
    premium?: boolean;
};

// The model's JSON drifts run to run (a spec value as a list or number, an
// extra highlight, a paragraph array) — read it leniently instead of failing
// the product.
export const text = (v: unknown): string =>
    Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).trim();
export const textList = (max: number) => z.preprocess(
    (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(text).filter(Boolean).slice(0, max),
    z.array(z.string()),
);
const looseText = z.preprocess((v) => (Array.isArray(v) ? v.map(text).join("\n\n") : text(v)), z.string());

export const copySchema = z.object({
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

export type Copy = z.infer<typeof copySchema>;

export type ProductCopy = Copy & {
    flow: AiCopyFlow;
    /** Pages the facts were read on — shown to staff so they can check. */
    sources: { title: string; url: string }[];
    /** Text assembled for InvProduct.shopDescription. */
    shopDescription: string;
    /** How this draft was made, in staff words. */
    note: string;
    /** Our own data looks wrong (typed name / specs vs photo or a matched page) — staff fix by hand. */
    flags: string[];
    /** Verified only: where each spec came from ("Label" or a site name). */
    specSources?: Record<string, string>;
    /** Verified only: what kinds of photo the gallery has / misses (photoChecklist.ts). */
    photoChecklist?: PhotoChecklist;
    /** Verified only: photos on the kept pages, for staff to pick from. */
    photoSuggestions?: PhotoSuggestion[];
    /** Verified with Photo AI: a better order and look for our gallery, for staff to apply. */
    photoArrange?: PhotoArrange;
};

const USE = "product_copy";

/** Drafting can run on this server — some draft key works here. */
export function isAiConfigured(): Promise<boolean> {
    return stepHasKey({ use: USE, step: "draft", premium: true });
}

const STRICT_RULES = [
    "STRICT RULE: say nothing false. State a fact only if it is in the product name, printed on the product or pack in the photo, or an official spec of this exact model you are certain of.",
    "If unsure (speed, chipset, part number, yield, OS support, compatibility, switch type), leave it out and list it in \"unsure\". Fewer true facts beat more doubtful ones.",
    "Colour: mention it only if the product name contains it — never from a photo or from memory. Never state design or what is in the box without a photo of the product itself.",
    "Compatibility: name exact model numbers only, never a series name alone; if unsure, leave it out.",
];

// A Flipkart-style page, compact: an SEO title, Highlights, a short
// Description, Compatible With, Specifications, and a Warranty line.
export const OUTPUT_KEYS = [
    "Style: simple, compact, SEO-friendly — brand, model number, product type and key specs in the words a customer types into Google. Lead with model and technical specifications. No filler, no repetition, no hype (\"best ever\", \"amazing\"), no keyword stuffing. Do not shorten true facts to save space.",
    "Return ONLY a JSON object, no markdown fence, with exactly these keys:",
    '"title": max 100 characters, written in your own words: Brand (official spelling) + Model name/number + product type + the top specs customers search for, a part code or spec in brackets, e.g. "Crucial 8GB DDR4 3200 MHz Laptop RAM (CT8G4SFRA32A)" or "HP 680 Black Original Ink Cartridge (F6V27AA)"; prefer an original title over copying a store listing or box tagline — if the natural best title happens to match one, that is fine; brand, model number and part codes stay exact; colour only if the product name has it;',
    '"summary": ONE sentence under 160 characters naming brand, model and product type with the main spec — used as the search-result snippet;',
    `"highlights": ${AI_HIGHLIGHT_COUNT.min}-${AI_HIGHLIGHT_COUNT.max} highlights, each under 12 words, spec-first (e.g. "8 GB DDR4 RAM", "3200 MHz Speed"), most useful first;`,
    '"description": ONE short paragraph in simple English: what it is, who it is for, what makes it useful — no line that only repeats the highlights;',
    '"compatibility": list of {"type": string, "models": string[]} guiding the customer to the products that go with this one, exact models only, e.g. ink/toner → {"type":"Printer","models":[...]}; printer → {"type":"Cartridge"/"Toner"/"Ink Refill","models":[part numbers]}; motherboard → {"type":"CPU","models":[socket + supported series]}, {"type":"RAM","models":["DDR5 up to 6000 MHz, max 128 GB"]}; RAM/SSD → the slot or interface it needs; [] if nothing certain;',
    '"howToUse": steps ONLY if printed on the product/label or given on the manufacturer website; otherwise [];',
    '"warranty": the MANUFACTURER\'s warranty as one line naming the maker, e.g. "3 Year Manufacturer Warranty (Logitech)" — only as printed on the label or given as a fact; never a shop\'s own support period; else "" and add "Manufacturer warranty" to "unsure";',
    '"specs": object of label → plain-text value, in this order: "Model Number", "Model Name", "Brand", then the technical specs for this product type, "Compatible Models" (if any), "In The Box" (only from a photo), last "Warranty Summary" (same as warranty, left out when warranty is "");',
    '"unsure": facts you left out because you were not sure;',
];

export function productLines(p: { name: string; brand?: string | null; category?: string | null }): string[] {
    return [
        `Product name: ${p.name}`,
        p.brand ? `Brand: ${p.brand}` : "",
        p.category ? `Category: ${p.category}` : "",
    ].filter(Boolean);
}

/** What each attached photo may be, and what may be read from it. */
export function photoLines(photoCount: number): string {
    if (photoCount === 0) return "";
    return [
        `${photoCount} photo${photoCount > 1 ? "s are" : " is"} attached. First decide what each one shows: the product itself, its box/pack, a label or spec sheet (back of box, warranty card), a promo/lifestyle picture (people, places, posters), or something that is not this product.`,
        "Read every word, number, code and logo printed on the product, box and labels — specs come only from those.",
        "A warranty printed on the box or label is the manufacturer warranty. Promo pictures: ignore the people and background and treat their slogans as marketing, not specs. Ignore any photo that is not this product.",
    ].join("\n");
}

function draftPrompt(p: ProductCopyInput, photoCount: number): string {
    return [
        "You write product listings for an Indian online shop.",
        ...productLines(p),
        photoLines(photoCount),
        ...STRICT_RULES,
        "",
        ...OUTPUT_KEYS,
    ].filter(Boolean).join("\n");
}

export function parseJson(text: string): unknown {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI reply had no JSON");
    return JSON.parse(text.slice(start, end + 1));
}

export type Part = { type: "text"; text: string } | { type: "file"; data: URL; mediaType: string };

/** The product's photos as message parts (http(s) only). */
export function photoParts(imageUrls: string[]): Part[] {
    return imageUrls.filter((u) => /^https?:\/\//.test(u)).map((u) => ({ type: "file", data: new URL(u), mediaType: "image" }));
}

/** One step of one AI use, on that step's chain of keys. */
export async function callStep(use: string, step: AiStep, content: Part[], opts: { premium: boolean; wait?: boolean }) {
    const { result, key } = await runChain(
        { use, step, premium: opts.premium, wait: opts.wait },
        (k, apiKey, signal) => callModel(k, apiKey, [{ role: "user", content }], { signal }),
    );
    return { reply: result, key: key.name };
}

/** The model answered, twice, with something that is not a usable reply. */
export class AiReplyError extends Error {
    constructor(cause: unknown) {
        super(`AI reply could not be read (${cause instanceof z.ZodError ? cause.issues.map((i) => i.path.join(".") || "reply").join(", ") : cause instanceof Error ? cause.message : "unknown"}) — press Generate again.`);
        this.name = "AiReplyError";
    }
}

/** Verified flow stopped at the photo check: our own data disagrees with itself. */
export class AiDataCheckError extends Error {
    constructor(readonly flags: string[]) {
        super(`Check this product's data first — ${flags.join("; ")}`);
        this.name = "AiDataCheckError";
    }
}

/** The reason in staff words, or null for an unexpected error. */
export function aiErrorMessage(e: unknown): string | null {
    return e instanceof AiReplyError || e instanceof AiDataCheckError ? e.message : keyErrorMessage(e);
}

const isKeysOut = (e: unknown) => e instanceof AiKeysExhaustedError || e instanceof AiRegularKeysOutError || e instanceof AiNoKeyError;

/** Run a call and parse its reply; one more try when the reply cannot be read at all. */
export async function callParsed<T>(run: () => Promise<{ reply: { text: string; usage?: { totalTokens?: number } }; key: string }>, parse: (raw: unknown) => T) {
    const once = async () => {
        const { reply, key } = await run();
        return { value: parse(parseJson(reply.text)), key, tokens: reply.usage?.totalTokens ?? 0 };
    };
    try {
        return await once();
    } catch (e) {
        if (aiStatus(e) !== undefined || isKeysOut(e)) throw e;
        try {
            return await once();
        } catch (again) {
            if (aiStatus(again) !== undefined || isKeysOut(again)) throw again;
            throw new AiReplyError(again);
        }
    }
}

/** No blank values, and one row per label whatever its case. */
export function cleanSpecs(raw: Record<string, string>): Record<string, string> {
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (!v.trim()) continue;
        const same = Object.keys(specs).find((x) => x.toLowerCase() === k.toLowerCase());
        if (!same) specs[k] = v.trim();
    }
    return specs;
}

/** Plain text in Flipkart's section order — the storefront shows it pre-wrapped. */
export function assembleDescription(c: Copy): string {
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

/** Direct AI: one Draft call from name + photo. */
export async function generateProductCopy(p: ProductCopyInput): Promise<ProductCopy> {
    const photos = photoParts(p.imageUrls);
    const started = Date.now();
    const { value: draft, key, tokens } = await callParsed(
        () => callStep(USE, "draft", [{ type: "text", text: draftPrompt(p, photos.length) }, ...photos], { wait: p.bulk, premium: !!p.premium }),
        (raw) => copySchema.parse(raw),
    );
    const final = { ...draft, specs: cleanSpecs(draft.specs) };
    console.info(`[aiProductCopy] direct done in ${Date.now() - started} ms · premium ${p.premium ? "yes" : "no"} · key ${key} · ${tokens} tokens`);
    return {
        ...final,
        flow: "direct",
        sources: [],
        flags: [],
        note: photos.length
            ? "Direct AI: written from the name and photo — check the specs before saving."
            : "Direct AI: written from the name only (no photo) — check every spec before saving.",
        shopDescription: assembleDescription(final),
    };
}
