import "server-only";
import { z } from "zod";
import { AI_HIGHLIGHT_COUNT, AI_PHOTO_LIMITS, type AiCopyFlow, type AiStep } from "@/shared/lib/constants/ai";
import { isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
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
    /** Collections the AI may pick from (full paths, Offers left out) — none = no picking. */
    collections?: { id: number; path: string }[];
    /** Brand master the AI may pick from — given → it also returns printedBrand / notes (in-app runs). */
    brands?: { id: number; name: string }[];
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
    /** Collection paths picked from the given list (collectionLines) — mapped to ids by pickCollections. */
    collections: textList(5).default([]),
    /** In-app runs (inAppLines): the brand printed on the item, and whether it is a well-known maker. */
    printedBrand: looseText.default(""),
    knownBrand: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
    /** In-app runs: problems in our data / photos for staff. */
    notes: textList(10).default([]),
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
    /** Notes for staff (Claude's or the in-app AI's): a brand / collection to create, a spelling mistake, a wrong group… */
    notes?: string[];
    /** In-app: a brand from the master to set — the form fills an empty Brand, else offers Use. */
    brandPick?: { id: number; name: string };
    /** In-app Verified: shipping proven on the label / an accepted page — the form fills empty boxes only. */
    shippingPick?: { weightGrams?: number; lengthCm?: number; breadthCm?: number; heightCm?: number };
    /** In-app: reasons to park in Attention (the route parks and sets `parked`). */
    attention?: string[];
    parked?: boolean;
    /** In-app Verified: Model No. / barcode read off the label, for the route to write when ours are empty. */
    codePick?: { modelNo?: string; barcode?: string };
    /** Verified only: where each spec came from ("Label" or a site name). */
    specSources?: Record<string, string>;
    /** Verified only: what kinds of photo the gallery has / misses (photoChecklist.ts). */
    photoChecklist?: PhotoChecklist;
    /** Verified only: photos on the kept pages, for staff to pick from. */
    photoSuggestions?: PhotoSuggestion[];
    /** Verified with Photo AI: a better order and look for our gallery, for staff to apply. */
    photoArrange?: PhotoArrange;
    /** In-app AI's collection picks, checked against the real list — the form fills an empty box or offers Use. */
    collectionPicks?: { id: number; path: string }[];
};

// Collections = customer segmentation (who buys / what they set up); the group
// is inventory (GST). Same rule Claude follows in the product-copy skill.
/** Prompt lines asking for "collections" — empty when no list was given. */
export function collectionLines(list: ProductCopyInput["collections"]): string[] {
    if (!list?.length) return [];
    return [
        '"collections": 1-3 entries copied EXACTLY from the list below. A collection is a CUSTOMER segment — who buys this ("Shop by Need › …") or the setup it belongs to ("Setup Kits › …") — not the product type. Add "Gaming" only for gaming / RGB / esports items or graphics cards. [] only if none fits.',
        `Collections: ${list.map((c) => c.path).join(" | ")}`,
    ];
}

/** Office-only quality levels for no-name goods (old names included) — not a real maker. */
export const UNBRANDED_RE = /^(premium unbranded|unbranded\+?|special|generic)$/i;

/** Prompt lines for the in-app extras (brand, staff notes) — empty unless a brand list was given. */
export function inAppLines(p: ProductCopyInput): string[] {
    if (!p.brands) return [];
    return [
        '"printedBrand": the brand name printed on the product or box, exactly as printed, else "";',
        '"knownBrand": true only if that printed brand is a well-known maker sold under that name across India; false for a little-known or no-name label;',
        '"notes": short lines for shop staff about problems in OUR data or photos — a misspelt product name, a product group that looks wrong for the item (GST), a model number or barcode printed but missing from the name, and: if the FIRST photo carries any logo, watermark, date stamp or text overlay (our own shop logo included), "Pick a clean primary photo — Google and Meta reject logos on the main image". A logo or watermark on the other photos is fine. [] if nothing.',
    ];
}

const brandKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Brand from the master only (owner, 2026-11-11). A set real brand is left
 * alone (a printed mismatch is the photo check's clash). Empty or Unbranded:
 * the printed brand when it is in the list; a well-known brand missing from
 * the list → Attention; otherwise Unbranded, the printed name staying in the title.
 */
export function resolveBrand(c: Copy, p: ProductCopyInput): { brandPick?: { id: number; name: string }; notes: string[]; attention?: string } {
    const list = p.brands ?? [];
    const cur = p.brand?.trim() ?? "";
    if (!list.length || (cur && !UNBRANDED_RE.test(cur))) return { notes: [] };
    const printed = c.printedBrand.trim();
    const hit = printed ? list.find((b) => brandKey(b.name) === brandKey(printed)) : undefined;
    if (hit && !UNBRANDED_RE.test(hit.name)) {
        return hit.name === cur ? { notes: [] } : { brandPick: hit, notes: [`Brand set to "${hit.name}" — printed on the item.`] };
    }
    if (printed && c.knownBrand) {
        return { notes: [], attention: `Brand "${printed}" is printed on the item but is not in the Brand list — create it, then set it.` };
    }
    if (cur) return { notes: [] };
    const unb = list.find((b) => /^unbranded$/i.test(b.name)) ?? list.find((b) => /^generic$/i.test(b.name));
    if (!unb) return { notes: ["No brand set — no \"Unbranded\" brand in the list to use."] };
    return {
        brandPick: unb,
        notes: [`Brand set to ${unb.name}${printed ? ` — printed name "${printed}" kept in the title` : ""}. Change to Premium Unbranded if this is the good-quality line.`],
    };
}

/** resolveBrand folded into the answer: brandPick, notes (AI's + brand's), attention reasons. */
export function withBrand(c: Copy, p: ProductCopyInput): { brandPick?: { id: number; name: string }; notes: string[]; attention: string[] } {
    const b = resolveBrand(c, p);
    return { ...(b.brandPick && { brandPick: b.brandPick }), notes: [...c.notes, ...b.notes], attention: b.attention ? [b.attention] : [] };
}

/** The AI's picked paths → real collections (exact path, else a unique leaf name). */
export function pickCollections(picked: string[], list: ProductCopyInput["collections"]): { id: number; path: string }[] {
    if (!list?.length) return [];
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const out = new Map<number, { id: number; path: string }>();
    for (const raw of picked) {
        const n = norm(raw);
        const hit = list.find((c) => norm(c.path) === n)
            ?? (() => { const leaf = list.filter((c) => norm(c.path.split("›").pop() ?? "") === n); return leaf.length === 1 ? leaf[0] : undefined; })();
        if (hit) out.set(hit.id, hit);
    }
    return [...out.values()];
}

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
        ...collectionLines(p.collections),
        ...inAppLines(p),
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
    return imageUrls.filter((u) => /^https?:\/\//.test(u)).map((u) => ({ type: "file", data: new URL(forAi(u)), mediaType: "image" }));
}

/**
 * Our Cloudinary photo as the AI gets it: no bigger than AI_PHOTO_LIMITS.maxPx, as
 * JPEG (every model reads it; f_auto could hand it AVIF). Shrunk first, then the
 * photo's own Adjust steps, so the AI still sees the look staff chose. A phone
 * shot sent whole made the call time out (owner's #1450, 2026-10-22). Other
 * sites' photos go as they are.
 */
function forAi(u: string): string {
    return isCloudinaryUrl(u)
        ? u.replace("/image/upload/", `/image/upload/c_limit,w_${AI_PHOTO_LIMITS.maxPx},h_${AI_PHOTO_LIMITS.maxPx},f_jpg,q_auto/`)
        : u;
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
        collectionPicks: pickCollections(draft.collections, p.collections),
        ...withBrand(final, p),
        sources: [],
        flags: [],
        note: photos.length
            ? "Direct AI: written from the name and photo — check the specs before saving."
            : "Direct AI: written from the name only (no photo) — check every spec before saving.",
        shopDescription: assembleDescription(final),
    };
}
