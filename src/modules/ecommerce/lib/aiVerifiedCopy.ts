import "server-only";
import { z } from "zod";
import { stepHasKey } from "@/shared/lib/ai/aiKeys";
import { AI_PHOTO_LIMITS, type AiStep } from "@/shared/lib/constants/ai";
import { checkFact, normForCheck } from "@/modules/ecommerce/lib/aiFactCheck";
import { findProductPages, type PageRead } from "@/modules/ecommerce/lib/aiPageReader";
import {
    AiDataCheckError, OUTPUT_KEYS, assembleDescription, callParsed, callStep, cleanSpecs, copySchema, photoLines, photoParts,
    productLines, text, textList, type ProductCopy, type ProductCopyInput,
} from "@/modules/ecommerce/lib/aiProductCopy";
import { PHOTO_GROUPS, PHOTO_KINDS, PHOTO_REMOVE_REASONS, checklistFrom, isPhotoKind, type PhotoKind, type PhotoRemoveReason, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

// Verified product copy (owner, 2026-10-21): "no information is better than
// false information". Tested on 6 real products before it was built.
//  1. Check (AI, photos) — our typed name / specs / codes against the photo.
//     A real clash stops here and is shown to staff; nothing is written.
//     Reads the label facts, any website printed on the box, the search text.
//  2. Pages (no AI, aiPageReader.ts) — maker's site, then big sellers. A page
//     with a different barcode of ours is dropped; one with our code is final.
//  3. Write (AI, text) — accepts or rejects each page against the label, then
//     writes from the label + accepted pages only, naming each fact's source.
//  4. Server check — every fact must really be on its source (aiFactCheck.ts);
//     a number from a seller page with no code match needs a second source.
// Warranty: our support period (the product's warranty term) is not the
// maker's — shorter is normal; only longer is flagged. The copy shows the
// maker's term only (see aiProductCopy.ts).
//  5. Photos (AI, photos, beside step 3) — what kinds of photo our gallery has
//     and misses, and what each web photo from the kept pages shows. Its own
//     call so the copy prompt stays as tested; a failure only drops the advice.

export type VerifiedCopyInput = ProductCopyInput & {
    modelNo?: string | null;
    /** EAN / UPC / barcode values from inv_product_codes. */
    codes: string[];
    /** Specs staff typed earlier (InvProduct.specsJson) — may be wrong. */
    typedSpecs?: Record<string, string> | null;
    /** Our own support period, in days — not the maker's warranty. */
    shopWarrantyDays?: number | null;
};

const USE = "product_copy_verified";

/** A Verified step with no keys of its own borrows the Direct AI keys. */
async function chainFor(step: AiStep, premium: boolean): Promise<[string, AiStep]> {
    return (await stepHasKey({ use: USE, step, premium })) ? [USE, step] : ["product_copy", "draft"];
}

const factMap = z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, text(x)])) : {}),
    z.record(z.string(), z.string()),
);

const checkSchema = z.object({
    clashes: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ field: z.string(), typed: z.unknown(), photo: z.unknown() }))).default([]),
    labelFacts: factMap.default({}),
    seen: factMap.default({}),
    identity: textList(10).default([]),
    labelCodes: textList(6).default([]),
    labelWebsite: z.preprocess(text, z.string()).default(""),
    branded: z.boolean().default(false),
    searchQuery: z.preprocess(text, z.string()).default(""),
});
type Check = z.infer<typeof checkSchema>;

const writeSchema = copySchema.extend({
    pages: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ page: z.preprocess(text, z.string()), accepted: z.boolean().default(false), why: z.preprocess(text, z.string()).default("") }))).default([]),
    specSources: factMap.default({}),
    dataFlags: textList(8).default([]),
});

/** 365 → "1 Year", 180 → "6 Month", 15 → "15 Day". */
function warrantyText(days: number): string {
    if (days % 365 === 0) return `${days / 365} Year`;
    if (days % 30 === 0) return `${days / 30} Month`;
    return `${days} Day`;
}

function checkPrompt(p: VerifiedCopyInput, photoCount: number): string {
    return [
        "You check one product of an Indian computer shop before we look it up online. Never use your own memory of this product.",
        "Our typed data (staff typed it — it may be wrong):",
        ...productLines(p),
        p.modelNo ? `Model no: ${p.modelNo}` : "",
        p.codes.length ? `Barcodes: ${p.codes.join(", ")}` : "",
        p.typedSpecs && Object.keys(p.typedSpecs).length ? `Typed specs: ${JSON.stringify(p.typedSpecs)}` : "",
        p.shopWarrantyDays ? `Shop support period (our own, NOT the maker's warranty): ${warrantyText(p.shopWarrantyDays)}` : "",
        photoLines(photoCount) || "There is NO photo — clashes, labelFacts and seen stay empty.",
        "1. clashes: every real disagreement between our typed data and the photo (typed data that is empty is never a clash) — a different brand or model, a different printed number (capacity, wattage, length, count printed on the box), or a photo that shows a different product. Not missing information, not spelling of the same thing (\"2 Yrs\" = \"2 Years\").",
        "   Warranty: our shop support period being SHORTER than the warranty printed on the box is normal, never a clash. Only a shop period LONGER than the printed warranty is a clash.",
        "   A count you can only see (sockets on one side, ports from one angle) is not printed — it can never be a clash.",
        "2. labelFacts: facts PRINTED on the product, box or label, copied as printed (label → value).",
        "3. seen: things only visible in the photo, worded \"at least N …\" for counts (label → value).",
        "4. identity: labels of the facts that tell this product apart from its sister models (capacity, volume, size, wattage, page yield, socket count…).",
        "5. labelCodes: model numbers, part codes and barcodes printed on the label.",
        "6. labelWebsite: a website printed on the box, else \"\".",
        "7. branded: true if this is a known brand with an exact model or part code (from the label or our data).",
        "8. searchQuery: brand + exact model/part code to find its official page; with no code but a website on the box, brand + product type + the main printed spec (e.g. \"CP PLUS Premium Series CCTV power supply 12V 10A\"); else \"\".",
        'Return ONLY JSON: {"clashes":[{"field":string,"typed":string,"photo":string}],"labelFacts":{},"seen":{},"identity":[],"labelCodes":[],"labelWebsite":string,"branded":boolean,"searchQuery":string}',
    ].filter(Boolean).join("\n");
}

function writePrompt(p: VerifiedCopyInput, c: Check, pages: PageRead[]): string {
    return [
        "You write a product listing for an Indian online shop from GIVEN FACTS ONLY. You arrange, select and summarise; you never add a fact of your own, never from memory. No information is better than false information.",
        ...productLines(p),
        `Label facts (printed on the product — the base truth): ${JSON.stringify(c.labelFacts)}`,
        Object.keys(c.seen).length ? `Seen in the photo (visible only, "at least"): ${JSON.stringify(c.seen)}` : "",
        c.identity.length ? `Identity facts (tell this product from its sister models): ${c.identity.join(", ")}` : "",
        `Our typed data (may be wrong — a hint, not a fact): model "${p.modelNo ?? ""}", barcodes ${p.codes.join(", ") || "none"}, specs ${JSON.stringify(p.typedSpecs ?? {})}`,
        pages.length ? "Web pages (pages showing a different barcode were already removed):" : "No web page could be found or read — write from the label facts only.",
        ...pages.map((pg, i) => `--- Page ${letter(i)}: ${pg.site}${pg.maker ? " (maker's site)" : " (seller)"} — ${pg.codeMatch ? "OUR CODE IS ON THIS PAGE: same product, accept it" : "no code match"}\n${pg.text}`),
        "Page rules:",
        "- A page with our code on it is the same product: accept it. If it disagrees with our typed data, add a dataFlag (e.g. \"Page with your barcode says 8 sockets; your name says 4\").",
        "- Any other page: accept only if it says nothing against any label fact or identity fact, and its identity facts (model, capacity, size, volume, yield) match where it states them. A page that simply does not mention a label fact (origin, series, colour code) is NOT a disagreement. One real disagreement rejects the whole page — it may be another version. A sister model (different capacity, size, volume, yield) is a different product. \"Seen\" counts are minimums, never a disagreement.",
        "- A page may add detail the label does not print; that is not a disagreement.",
        "- Use English text only; leave out product names or values written in another language.",
        "- Never use a fact from a rejected page.",
        "Warranty: only the MAKER's warranty from the label or an accepted page. Our shop support period is never written.",
        "",
        ...OUTPUT_KEYS,
        '"pages": [{"page": "A", "accepted": boolean, "why": string}] for every page;',
        '"specSources": for every key in "specs", where the value came from: "label" or the page letter;',
        '"dataFlags": places where our typed data DISAGREES with the label or an accepted page, in simple words. Typed data that is empty or shorter is not a flag; our shop support period being shorter than the maker\'s warranty is not a flag.',
    ].filter(Boolean).join("\n");
}

const kindList = z.preprocess((v) => (Array.isArray(v) ? v.filter(isPhotoKind) : []), z.array(z.string())).default([]);
const photoSchema = z.object({
    have: kindList,
    must: kindList,
    nice: kindList,
    remove: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ photo: z.coerce.number(), why: z.unknown(), note: z.preprocess(text, z.string()).default("") }))).default([]),
    web: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ n: z.coerce.number(), kind: z.unknown(), same: z.boolean().default(true) }))).default([]),
});

function photoPrompt(p: VerifiedCopyInput, ours: number, web: number): string {
    return [
        "You check the photo gallery of one product in an Indian online shop.",
        ...productLines(p),
        ours ? `The first ${ours} photo${ours > 1 ? "s are" : " is"} OUR gallery.` : "We have NO photo yet.",
        web ? `The next ${web} photo${web > 1 ? "s are" : " is"} from the maker's or sellers' pages, numbered 1 to ${web}.` : "",
        "Photo kinds:",
        ...Object.entries(PHOTO_GROUPS).map(([g, name]) => `- ${name}: ${Object.entries(PHOTO_KINDS).filter(([, v]) => v.group === g).map(([k, v]) => `${k} (${v.label})`).join(", ")}`),
        "Goal: the buyer should almost hold and use the product through the photos, and want it at once.",
        "have: the kinds our gallery already shows.",
        "must: kinds our gallery lacks that a buyer NEEDS to judge THIS product, most important first (usually front, then size).",
        "nice: kinds our gallery lacks that add feel and impulse, most useful first.",
        "Rules:",
        "- Product sides: list a side only if it shows something a buyer checks (ports, buttons, label, mount, cable exit). Skip plain sides and sides that look like another side (a pen drive's bottom; a router's back has the ports, so ask for it).",
        "- Box sides: list a side only if this product's box would carry something useful there (specs, feature list, compatibility list, barcode, contents). Never a blank side or one that repeats another.",
        "- Feel photos: always consider them, fitted to the product (a cable: size, working; a speaker: in_use, cinematic). size = any photo that lets the buyer gauge the size.",
        "- Never list a kind that makes no sense for this product.",
        ours ? `remove: our photos (numbered 1 to ${ours} in the order given) that should go — why "duplicate" (almost the same picture as another of ours: keep the better one, list only the weaker; a box shot and a product shot are never duplicates), "irrelevant" (not this product, only a logo, a poster unrelated to it), or "quality" (blurry, dark, tiny, cut off, heavy watermark). note: a few words for staff. Empty when every photo is fine.` : "",
        web ? "web: for every web photo, its number, its kind, and same=false if it shows a different product, a different model or colour, only a logo, or is almost the same picture as one of ours." : "",
        'Return ONLY JSON: {"have":[kind],"must":[kind],"nice":[kind],"remove":[{"photo":number,"why":string,"note":string}],"web":[{"n":number,"kind":kind,"same":boolean}]}',
    ].filter(Boolean).join("\n");
}

/** Photo advice and the web photos to suggest; null when the AI could not answer (the copy is unaffected). */
async function photoAdvice(p: VerifiedCopyInput, ours: ReturnType<typeof photoParts>, pages: PageRead[], premium: boolean) {
    // Maker's and code-matched pages first, one URL once.
    const ranked = [...pages].sort((a, b) => Number(b.codeMatch) - Number(a.codeMatch) || Number(b.maker) - Number(a.maker));
    const seen = new Set<string>(p.imageUrls);
    const web = ranked.flatMap((pg) => pg.photos.map((url) => ({ url, site: pg.site })))
        .filter((x) => !seen.has(x.url) && seen.add(x.url))
        .slice(0, AI_PHOTO_LIMITS.total);
    const [use, step] = await chainFor("check", premium);
    const ask = (withWeb: boolean) => callParsed(
        () => callStep(use, step, [
            { type: "text", text: photoPrompt(p, ours.length, withWeb ? web.length : 0) },
            ...ours,
            ...(withWeb ? photoParts(web.map((x) => x.url)) : []),
        ], { wait: p.bulk, premium }),
        (raw) => photoSchema.parse(raw),
    );
    let answer;
    try {
        answer = (await ask(web.length > 0)).value;
    } catch (e) {
        // A seller site refusing the model's download fails the whole call — ask again about ours only.
        if (!web.length) { console.warn("[aiVerifiedCopy] photo advice failed", e); return null; }
        try { answer = (await ask(false)).value; } catch (e2) { console.warn("[aiVerifiedCopy] photo advice failed", e2); return null; }
    }
    // Same order photoParts sent them in; saved by URL so a reorder cannot point at the wrong photo.
    const ourUrls = p.imageUrls.filter((u) => /^https?:\/\//.test(u));
    const removals = answer.remove.flatMap((x) => {
        const url = ourUrls[x.photo - 1];
        const why = String(x.why).toLowerCase();
        return url && why in PHOTO_REMOVE_REASONS ? [{ url, why: why as PhotoRemoveReason, note: x.note.slice(0, 200) }] : [];
    }).filter((x, i, all) => all.findIndex((y) => y.url === x.url) === i);
    const verdict = new Map(answer.web.map((x) => [x.n, x]));
    const suggestions: PhotoSuggestion[] = web.flatMap((x, i) => {
        const v = verdict.get(i + 1);
        if (v && !v.same) return [];
        return [{ ...x, kind: v && isPhotoKind(v.kind) ? v.kind : null }];
    });
    return { checklist: checklistFrom(answer.have as PhotoKind[], answer.must as PhotoKind[], answer.nice as PhotoKind[], removals), suggestions };
}

const letter = (i: number) => String.fromCharCode(65 + i);
const numbersIn = (s: string) => normForCheck(s).match(/\d+(?:\.\d+)?/g) ?? [];

export async function generateVerifiedCopy(p: VerifiedCopyInput): Promise<ProductCopy> {
    const premium = !!p.premium;
    const photos = photoParts(p.imageUrls);
    const started = Date.now();

    // ── 1. Check
    const [checkUse, checkStep] = await chainFor("check", premium);
    const { value: check, key: checkKey } = await callParsed(
        () => callStep(checkUse, checkStep, [{ type: "text", text: checkPrompt(p, photos.length) }, ...photos], { wait: p.bulk, premium }),
        (raw) => checkSchema.parse(raw),
    );
    if (check.clashes.length) {
        throw new AiDataCheckError(check.clashes.map((x) => `${x.field}: typed "${text(x.typed)}", photo shows "${text(x.photo)}"`));
    }

    // ── 2. Pages
    // No model code but a barcode of ours: the maker's and sellers' pages often carry it.
    const query = check.searchQuery.trim() || (p.codes[0] && p.brand ? `${p.brand} ${p.codes[0]}` : "");
    const found = query && (check.branded || check.labelWebsite || p.codes.length)
        ? await findProductPages({ query, brand: p.brand ?? query.split(/\s+/)[0], labelSite: check.labelWebsite, codes: [...p.codes, ...(p.modelNo ? [p.modelNo] : []), ...check.labelCodes] })
        : { pages: [] as PageRead[], dropped: [] as string[], searchNote: "No brand with a model code, barcode or website on the box — no page search" };

    // ── 3. Write, with 5. Photos beside it
    const [writeUse, writeStep] = await chainFor("write", premium);
    const [{ value: w, key: writeKey }, photos5] = await Promise.all([
        callParsed(
            () => callStep(writeUse, writeStep, [{ type: "text", text: writePrompt(p, check, found.pages) }], { wait: p.bulk, premium }),
            (raw) => writeSchema.parse(raw),
        ),
        // Bulk writes descriptions only — no one is there to pick photos.
        p.bulk ? Promise.resolve(null) : photoAdvice(p, photos, found.pages, premium),
    ]);

    // ── 4. Server check: a code match is final whatever the AI said; every fact must be on its source.
    const accepted = new Map<string, PageRead>();
    found.pages.forEach((pg, i) => {
        const verdict = w.pages.find((x) => x.page.trim().toUpperCase() === letter(i));
        if (pg.codeMatch || verdict?.accepted) accepted.set(letter(i), pg);
    });
    // The product name is our typed data — a fact found only there is shown as "Product name", not "Label".
    const printedNorm = normForCheck([...Object.entries(check.labelFacts).flat(), ...Object.entries(check.seen).flat()].join(" "));
    const labelNorm = normForCheck(p.name) + printedNorm;
    const trusted = [...accepted.values()];
    const unsure = [...w.unsure];
    const specSources: Record<string, string> = {};

    /** The value as its source shows it, or null. Seller numbers without a code match need a second source. */
    const confirm = (label: string, value: string, source: string): string | null => {
        const src = source.trim().toUpperCase();
        if (src === "LABEL") return checkFact(labelNorm, label, value);
        const pg = accepted.get(src);
        const kept = pg ? checkFact(pg.norm, label, value) : null;
        if (!pg || !kept) return null;
        if (pg.codeMatch || pg.maker || numbersIn(kept).length === 0) return kept;
        const second = [labelNorm, ...trusted.filter((x) => x !== pg).map((x) => x.norm)].some((n) => checkFact(n, label, kept));
        return second ? kept : null;
    };
    const anySource = (label: string, value: string) =>
        [labelNorm, ...trusted.map((x) => x.norm)].map((n) => checkFact(n, label, value)).find((v) => v) ?? null;

    const specs: Record<string, string> = {};
    for (const [label, value] of Object.entries(w.specs)) {
        // A count only seen in a photo is a minimum, never a spec.
        if (/\bat least\b/i.test(value)) continue;
        const source = w.specSources[label] ?? "";
        const kept = confirm(label, value, source);
        if (kept) {
            specs[label] = kept;
            specSources[label] = source.trim().toUpperCase() !== "LABEL" ? accepted.get(source.trim().toUpperCase())?.site ?? source
                : checkFact(printedNorm, label, kept) ? "Label" : "Product name";
        } else unsure.push(`${label}: ${value} (not confirmed by the label or an accepted page)`);
    }
    const compatibility = w.compatibility
        .map((g) => ({ ...g, models: g.models.filter((m) => anySource(`Compatible ${g.type}`, m)) }))
        .filter((g) => g.models.length);
    const warranty = w.warranty && numbersIn(w.warranty).every((n) => [labelNorm, ...trusted.map((x) => x.norm)].some((t) => t.includes(n))) ? w.warranty : "";
    if (w.warranty && !warranty) unsure.push("Manufacturer warranty (could not be confirmed)");
    // A highlight with a number nobody printed is dropped; words-only highlights stay.
    const highlights = w.highlights.filter((h) => numbersIn(h).every((n) => [labelNorm, ...trusted.map((x) => x.norm)].some((t) => t.includes(n))));

    const final = {
        title: w.title, summary: w.summary, description: w.description, howToUse: w.howToUse,
        highlights: highlights.length ? highlights : [w.title], warranty, compatibility,
        specs: cleanSpecs(specs), unsure: [...new Set(unsure)],
    };
    const rejected = found.pages.flatMap((pg, i) => (accepted.has(letter(i))
        ? []
        : [`${pg.site}: ${w.pages.find((x) => x.page.trim().toUpperCase() === letter(i))?.why || "rejected"}`]));
    const used = trusted.map((pg) => `${pg.site}${pg.codeMatch ? " (barcode matched)" : ""}`);
    const note = [
        used.length ? `Verified: label + ${used.join(", ")}.` : `Verified: from the label only${found.searchNote ? ` (${found.searchNote})` : ""}.`,
        rejected.length || found.dropped.length ? `Not used: ${[...found.dropped, ...rejected].join("; ")}.` : "",
    ].filter(Boolean).join(" ");

    console.info(`[aiVerifiedCopy] done in ${Date.now() - started} ms · check ${checkKey} · write ${writeKey} · pages ${found.pages.length} read, ${trusted.length} used · specs ${Object.keys(final.specs).length} kept`);
    return {
        ...final,
        flow: "verified",
        sources: trusted.map((pg) => ({ title: pg.site, url: pg.url })),
        flags: w.dataFlags,
        note,
        specSources,
        shopDescription: assembleDescription(final),
        // Only photos from pages the copy kept: a rejected page may be another version.
        ...(photos5 && {
            photoChecklist: photos5.checklist,
            photoSuggestions: photos5.suggestions.filter((s) => trusted.some((pg) => pg.site === s.site)),
        }),
    };
}
