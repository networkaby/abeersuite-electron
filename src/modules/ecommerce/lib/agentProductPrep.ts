import "server-only";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";
import { AI_PHOTO_LIMITS } from "@/shared/lib/constants/ai";
import { COMPATIBLE_SPEC } from "@/shared/lib/shop/compatibility";
import { getR2Text, isR2Configured, messagesBucket, putR2 } from "@/shared/lib/storage/r2";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import { readShopDraft } from "@/modules/ecommerce/lib/productAdmin";
import type { ShopProductPatch } from "@/modules/ecommerce/lib/updateShopProduct";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";
import { arrangeFrom, checkWrittenCopy, writtenCopySchema } from "@/modules/ecommerce/lib/aiVerifiedCopy";
import { readGivenPages, type PageSearch } from "@/modules/ecommerce/lib/aiPageReader";
import { checkFact, cmOf, gramsOf } from "@/modules/ecommerce/lib/aiFactCheck";
import { PHOTO_REMOVE_REASONS, checklistFrom, isPhotoKind, type PhotoKind, type PhotoRemoveReason, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";
import { cloudinarySignature } from "@/shared/lib/cloudinary";
import { AgentCopyError, pickableMasters, productForAgent, specsOf, writeAsDraft } from "@/modules/ecommerce/lib/agentProductCopy";

/**
 * Product prep — Claude's four-part loop (owner, 2026-11-16), separate from
 * product-copy (agentProductCopy.ts, untouched) and from our own Gemini AI.
 *
 *   Part 1 Prepare seed  — remove wrong data only; enough to search? fail → Attention
 *   Part 2 Search        — ONE search per product lifecycle; the read pages are SAVED
 *   Part 3 Process       — from the saved pages only: copy, brand, collections, shipping, photos → Draft
 *   Part 4 Verify        — no internet; ready, or Attention with only what is pending
 *
 * Only a MAJOR problem (one that would spoil the next part) stops a part.
 * The saved search lives in the private R2 bucket at ai-prep/<id>.json — no
 * schema change (owner chose this over a table). It is tied to the identity it
 * was searched for (brand + model + barcodes): when staff change those, the
 * saved search no longer counts and one new search is allowed.
 * Skills: .claude/skills/product-prep, .claude/skills/product-recheck.
 */

const galleryOf = (p: { galleryJson: unknown; imageUrl: string | null }) => productGalleryUrls(p.galleryJson as never, p.imageUrl);
const keyOf = (id: number) => `ai-prep/${id}.json`;
const SIGN = (n: number) => `Part ${n} done`;

type Identity = { brand: string; model: string; barcodes: string[] };
const identityKey = (i: Identity) => [i.brand, i.model, ...[...i.barcodes].sort()].map((x) => x.trim().toLowerCase()).join("|");

/** What is saved in R2 for one product. */
type PrepState = {
    part: 1 | 2 | 3 | 4;
    at: string;
    identity: Identity;
    search?: {
        at: string;
        found: PageSearch;
        /** url → Claude's verdict, as sent with the search. */
        verdicts: { url: string; accepted: boolean; why: string }[];
        labelFacts: Record<string, string>;
        seen: Record<string, string>;
        labelWebsite: string;
    };
};

function requireR2() {
    if (!isR2Configured()) throw new AgentCopyError("R2 storage is not set up on this server — product prep needs it to save the search.");
}

async function readState(id: number): Promise<PrepState | null> {
    requireR2();
    const raw = await getR2Text(messagesBucket(), keyOf(id));
    if (!raw) return null;
    try { return JSON.parse(raw) as PrepState; } catch { return null; }
}

async function writeState(id: number, s: PrepState) {
    requireR2();
    await putR2(messagesBucket(), keyOf(id), new TextEncoder().encode(JSON.stringify(s)).buffer as ArrayBuffer, "application/json");
}

async function currentIdentity(id: number): Promise<Identity> {
    const p = await prisma.invProduct.findUniqueOrThrow({
        where: { id },
        select: { modelNo: true, brand: { select: { name: true } }, codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } } },
    });
    return { brand: p.brand?.name ?? "", model: p.modelNo ?? "", barcodes: p.codes.map((c) => c.value) };
}

/** The saved state, or null when it was searched for another identity (staff changed brand / model / barcode). */
async function liveState(id: number): Promise<{ state: PrepState | null; identityChanged: boolean }> {
    const s = await readState(id);
    if (!s) return { state: null, identityChanged: false };
    const now = await currentIdentity(id);
    if (identityKey(now) !== identityKey(s.identity)) return { state: null, identityChanged: true };
    return { state: s, identityChanged: false };
}

/** Add lines to the Draft notes ("Notes for you"), sign lines replaced. */
async function addDraftNotes(id: number, lines: string[]) {
    const row = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { shopDraftJson: true } });
    const info = readShopDraft(row.shopDraftJson) ?? {};
    const old = (info.notes ?? []).filter((n) => !/^Part \d done/.test(n));
    const notes = [...new Set([...old, ...lines])].slice(-40);
    await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: { ...info, notes, notesAt: new Date().toISOString(), kept: undefined } as never } });
}

/** Copy a page photo into our Cloudinary (shop/products) — Cloudinary fetches the URL itself. Null when it fails. */
async function copyToOurPhotos(url: string): Promise<string | null> {
    const sig = await cloudinarySignature("shop/products");
    if (!sig) return null;
    const form = new FormData();
    form.append("file", url);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return null;
        return ((await res.json()) as { secure_url?: string }).secure_url ?? null;
    } catch {
        return null;
    }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Everything product-copy's read gives, plus what the loop needs: title, group, shipping, old notes, the part done, the saved search. */
export async function productForPrep(id: number) {
    const base = await productForAgent(id);
    if (!base) return null;
    const p = await prisma.invProduct.findUniqueOrThrow({
        where: { id },
        select: {
            shopSubheading: true, shopAttention: true, shopDraftJson: true,
            weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true,
            group: { select: { name: true } },
        },
    });
    const draft = readShopDraft(p.shopDraftJson);
    const { state, identityChanged } = await liveState(id);
    const search = state?.search;
    return {
        ...base,
        /** The online name (shown on the shop). `name` is our office name. */
        title: p.shopSubheading,
        /** Inventory group — drives GST. Never yours to change; note it when wrong. */
        group: p.group?.name ?? null,
        shipping: { weightGrams: p.weightGrams, lengthCm: p.lengthCm, breadthCm: p.breadthCm, heightCm: p.heightCm },
        /** The Attention reason now (a part that stopped), one problem per line. */
        attention: p.shopAttention,
        /** Notes in Draft — the earlier parts' notes and signs. */
        draftNotes: draft?.notes ?? [],
        /** Notes from the last Part 3 (aiCopy). */
        processNotes: draft?.aiCopy?.notes ?? [],
        prep: {
            /** The last part finished (0 = none). Start at the next one. */
            partDone: state?.part ?? 0,
            /** Staff changed brand / model / barcode after the search — the saved search is void; start again at Part 1. */
            identityChanged,
            /** True only when no search is saved for this identity. Part 2 refuses a second search. */
            searchAllowed: !search,
            searchedAt: search?.at ?? null,
            /** The saved pages: what Part 3 and Part 4 work from. Never search again. */
            pages: search?.found.pages.map((pg) => {
                const v = search.verdicts.find((x) => x.url === pg.url);
                return { url: pg.url, site: pg.site, maker: pg.maker, codeMatch: pg.codeMatch, accepted: pg.codeMatch || !!v?.accepted, why: v?.why ?? "", text: pg.text, photos: pg.photos };
            }) ?? [],
            dropped: search?.found.dropped ?? [],
            labelFacts: search?.labelFacts ?? {},
            seen: search?.seen ?? {},
            labelWebsite: search?.labelWebsite ?? "",
        },
    };
}

// ── Part 1: prepare the seed (remove wrong data only) ─────────────────────────

const removal = z.object({ url: z.string().url(), why: z.string(), note: z.string().max(200).default("") });
const lines = z.array(z.string().trim().min(1).max(300)).max(40).default([]);

export const part1Schema = z.object({
    /** Photos you are SURE are wrong (another product, exact duplicate, unusable) — removed now. */
    remove: z.array(removal).max(30).default([]),
    /** Photos you are NOT sure about — left for staff with a Remove button. */
    suggestRemove: z.array(removal).max(30).default([]),
    /** Wrong data to clear. Group is never cleared (GST) — note it instead. */
    clear: z.object({
        brand: z.boolean().default(false),
        title: z.boolean().default(false),
        description: z.boolean().default(false),
        collections: z.boolean().default(false),
        /** Spec labels to drop. */
        specs: z.array(z.string()).max(50).default([]),
        shipping: z.boolean().default(false),
    }).default({ brand: false, title: false, description: false, collections: false, specs: [], shipping: false }),
    /** MAJOR problems: any → the product stops in Attention. */
    major: lines,
    /** Minor problems — notes, the loop goes on. */
    notes: lines,
    /** After the clean-up, is what is left enough to search (brand + model, part code, barcode or clear box text)? */
    enough: z.boolean(),
    /** When not enough: what staff must add ("a box / label photo", "the model no."). */
    need: z.string().trim().max(300).default(""),
});

export async function savePart1(id: number, b: z.infer<typeof part1Schema>) {
    requireR2();
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true, specsJson: true } });
    if (!p) throw new AgentCopyError("Product not found");
    const gallery = galleryOf(p);
    const gone = new Set(b.remove.map((r) => r.url).filter((u) => gallery.includes(u)));
    const patch: ShopProductPatch = {};
    const done: string[] = [];
    if (gone.size) {
        patch.galleryUrls = gallery.filter((u) => !gone.has(u));
        patch.imageUrl = patch.galleryUrls[0] ?? null;
        done.push(`Removed ${gone.size} wrong photo(s): ${b.remove.filter((r) => gone.has(r.url)).map((r) => r.note || r.why).join("; ")}.`);
    }
    if (b.clear.brand) { patch.brandId = null; done.push("Brand cleared (wrong)."); }
    if (b.clear.title) { patch.shopSubheading = null; done.push("Online name cleared (wrong)."); }
    if (b.clear.description) { patch.shopDescription = null; done.push("Description cleared (wrong)."); }
    if (b.clear.collections) { patch.collectionIds = []; done.push("Collections cleared (wrong)."); }
    if (b.clear.specs.length) {
        const drop = new Set(b.clear.specs.map((k) => k.trim().toLowerCase()));
        patch.specs = Object.fromEntries(Object.entries(specsOf(p.specsJson) ?? {}).filter(([k]) => !drop.has(k.trim().toLowerCase())));
        done.push(`Spec rows cleared (wrong): ${b.clear.specs.join(", ")}.`);
    }
    if (b.clear.shipping) {
        Object.assign(patch, { weightGrams: null, lengthCm: null, breadthCm: null, heightCm: null });
        done.push("Shipping weight / size cleared (wrong).");
    }
    const unsure = b.suggestRemove
        .filter((r) => gallery.includes(r.url) && !gone.has(r.url))
        .map((r) => `Check photo ${gallery.indexOf(r.url) + 1}: ${r.note || r.why} — remove it if it is wrong.`);

    const stop = b.major.length > 0 || !b.enough;
    await writeAsDraft(id, patch, () => ({}));
    if (stop) {
        const reason = [
            ...b.major.map((m) => `STOPPED (Part 1) — ${m}`),
            ...(!b.enough ? [`STOPPED (Part 1) — not enough to search${b.need ? `: ${b.need}` : ""}. Add it, then run product prep again.`] : []),
            ...done, ...unsure, ...b.notes,
        ];
        await parkInAttention([id], reason.join("\n").slice(0, 10000), "Claude", "any");
        return { result: "attention" as const, removed: gone.size, notes: reason.length };
    }
    // A search saved for this same identity is kept (one search per lifecycle).
    const { state: prev } = await liveState(id);
    await writeState(id, { ...(prev?.search && { search: prev.search }), part: prev?.search ? Math.max(prev.part, 1) as PrepState["part"] : 1, at: new Date().toISOString(), identity: await currentIdentity(id) });
    await addDraftNotes(id, [...done, ...unsure, ...b.notes, SIGN(1)]);
    return { result: "part1" as const, removed: gone.size, notes: done.length + unsure.length + b.notes.length };
}

// ── Part 2: the one search, saved ─────────────────────────────────────────────

const record = z.record(z.string(), z.coerce.string()).default({});

export const part2Schema = z.object({
    /** Every page read, accepted or not. Empty = the search found nothing usable. */
    pages: z.array(z.object({ url: z.string().url(), accepted: z.boolean(), why: z.string().trim().max(300).default("") })).max(8).default([]),
    labelFacts: record,
    seen: record,
    labelWebsite: z.string().trim().max(200).default(""),
    /** Only when the owner asks to run Part 2 again: replaces the saved search. */
    again: z.boolean().default(false),
});

export async function savePart2(id: number, b: z.infer<typeof part2Schema>) {
    const { state, identityChanged } = await liveState(id);
    if (!state || state.part < 1) throw new AgentCopyError(identityChanged ? "Brand / model / barcode changed since Part 1 — run Part 1 again first." : "Part 1 is not done for this product — run it first.");
    if (state.search && !b.again) throw new AgentCopyError(`Already searched on ${state.search.at.slice(0, 10)} — one search per product. Use the saved pages (Part 3); send "again": true only when the owner asks.`);
    const p = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const identity = await currentIdentity(id);
    const found: PageSearch = !b.pages.length ? { pages: [], dropped: [], searchNote: "The search found no usable page" } : await readGivenPages({
        urls: b.pages.map((x) => x.url),
        brand: identity.brand || p.name.split(/\s+/)[0] || "",
        labelSite: b.labelWebsite,
        codes: [...identity.barcodes, ...(identity.model ? [identity.model] : [])],
    });
    const verdicts = b.pages.map((x) => ({ url: x.url, accepted: x.accepted, why: x.why }));
    const accepted = found.pages.filter((pg) => pg.codeMatch || verdicts.find((v) => v.url === pg.url)?.accepted);
    const next: PrepState = {
        // No good page is not a stop (owner, 2026-11-17): searching again gains
        // nothing without new seed, so Part 3 goes on from the label and photos.
        part: 2,
        at: new Date().toISOString(),
        identity,
        search: { at: new Date().toISOString(), found, verdicts, labelFacts: b.labelFacts, seen: b.seen, labelWebsite: b.labelWebsite },
    };
    await writeState(id, next);
    await addDraftNotes(id, [
        accepted.length
            ? `Searched once: ${accepted.length} page(s) kept (${accepted.map((pg) => pg.site).join(", ")}).`
            : "Searched once: no maker or seller page matched — the copy is from the label and photos only.",
        SIGN(2),
    ]);
    return {
        result: accepted.length ? ("part2" as const) : ("no-good-page" as const),
        read: found.pages.map((pg) => ({ url: pg.url, site: pg.site, maker: pg.maker, codeMatch: pg.codeMatch, accepted: accepted.includes(pg) })),
        dropped: found.dropped,
    };
}

// ── Part 3: process from the saved pages ──────────────────────────────────────

const photoPick = z.object({ url: z.string().url(), kind: z.string().optional() });

export const part3Schema = z.object({
    /** The improved copy, keys as `writing` says, with specSources ("label" or a saved page url). */
    copy: z.record(z.string(), z.unknown()),
    brandId: z.number().int().positive().optional(),
    /** The collections, main first — they REPLACE the ones set now. */
    collectionIds: z.array(z.number().int().positive()).min(1).max(10),
    shipping: z.object({ weight: z.string().trim().max(60).optional(), dimensions: z.string().trim().max(80).optional(), source: z.string().trim().max(500) }).optional(),
    photos: z.object({
        /** From the saved pages, sure: added to the gallery now. */
        add: z.array(photoPick).max(15).default([]),
        /** From the saved pages, not sure: shown to staff to add. */
        suggest: z.array(photoPick).max(15).default([]),
        /** Our photos, sure wrong: removed now. */
        remove: z.array(removal).max(30).default([]),
        /** Our photos, not sure: Remove buttons for staff. */
        suggestRemove: z.array(removal).max(30).default([]),
        /** The gallery in order (our kept photos + added ones) — applied now. */
        order: z.array(z.string().url()).max(40).default([]),
        look: z.array(z.object({
            url: z.string().url(), crop: z.string().optional(), focus: z.string().optional(),
            fixes: z.array(z.string()).default([]), rotate: z.coerce.number().catch(0).default(0),
            background: z.string().optional(), why: z.string().trim().max(120).default(""),
        })).max(30).default([]),
        have: z.array(z.string()).default([]),
        must: z.array(z.string()).default([]),
        nice: z.array(z.string()).default([]),
    }).default({ add: [], suggest: [], remove: [], suggestRemove: [], order: [], look: [], have: [], must: [], nice: [] }),
    notes: lines,
});

export async function savePart3(id: number, b: z.infer<typeof part3Schema>) {
    const { state, identityChanged } = await liveState(id);
    if (!state?.search || state.part < 2) throw new AgentCopyError(identityChanged ? "Brand / model / barcode changed since the search — start again at Part 1." : "No saved search — Part 2 is not done.");
    const s = state.search;
    const p = await prisma.invProduct.findUniqueOrThrow({
        where: { id },
        select: { name: true, imageUrl: true, galleryJson: true, specsJson: true, brandId: true, brand: { select: { name: true } }, weightGrams: true, lengthCm: true },
    });

    // The fact check, exactly as product-copy's — but on the SAVED pages, no download.
    const letterOf = new Map(s.found.pages.map((pg, i) => [pg.url, String.fromCharCode(65 + i)]));
    const raw = b.copy as Record<string, unknown>;
    const sources = raw.specSources && typeof raw.specSources === "object" ? (raw.specSources as Record<string, unknown>) : {};
    const written = writtenCopySchema.safeParse({
        ...raw,
        pages: s.found.pages.map((pg, i) => {
            const v = s.verdicts.find((x) => x.url === pg.url);
            return { page: String.fromCharCode(65 + i), accepted: !!v?.accepted, why: v?.why ?? "" };
        }),
        specSources: Object.fromEntries(Object.entries(sources).map(([k, v]) => {
            const t = String(v ?? "").trim();
            return [k, t.toLowerCase() === "label" ? "label" : letterOf.get(t) ?? ""];
        })),
    });
    if (!written.success) throw new AgentCopyError(`copy does not match the keys in "writing": ${written.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    const checked = checkWrittenCopy(p.name, { labelFacts: s.labelFacts, seen: s.seen }, s.found, written.data);

    const notes = [...b.notes];
    const patch: ShopProductPatch = { shopDescription: checked.copy.shopDescription, shopSubheading: checked.copy.title };

    // Specs: improved rows replace ours with the same label; our other rows stay.
    const compat = checked.copy.compatibility.flatMap((g) => g.models);
    const rows = Object.entries({ ...checked.copy.specs, ...(compat.length && { [COMPATIBLE_SPEC]: compat.join(", ") }) }).filter(([, v]) => v.trim());
    if (rows.length) {
        const theirs = new Set(rows.map(([k]) => k.trim().toLowerCase()));
        patch.specs = { ...Object.fromEntries(Object.entries(specsOf(p.specsJson) ?? {}).filter(([k]) => !theirs.has(k.trim().toLowerCase()))), ...Object.fromEntries(rows) };
    }

    // Brand: from the list only; not in it → a note, no stop (Part 4 checks it again).
    const masters = await pickableMasters();
    if (b.brandId) {
        const br = masters.brands.find((x) => x.id === b.brandId);
        if (!br) notes.push(`Brand id ${b.brandId} is not an active brand — not set. Create the brand, then set it.`);
        else if (p.brandId !== br.id) { patch.brandId = br.id; notes.push(`Brand set to "${br.name}"${p.brand?.name ? ` (was "${p.brand.name}")` : ""}.`); }
    }
    // Collections: set fresh (replace), main first.
    const unknown = b.collectionIds.filter((c) => !masters.collections.some((x) => x.id === c));
    if (unknown.length) notes.push(`Collection id ${unknown.join(", ")} does not exist — not set.`);
    const cols = b.collectionIds.filter((c) => !unknown.includes(c));
    if (cols.length) patch.collectionIds = [...new Set(cols)];

    // Shipping: fill only when empty, and say it came from the internet.
    if (b.shipping) {
        const src = b.shipping.source.trim();
        const pg = s.found.pages.find((x) => x.url === src && checked.trusted.includes(x));
        if (!pg) notes.push(`Shipping not used: "${src}" is not a kept page.`);
        else {
            const w = b.shipping.weight && checkFact(pg.norm, "Weight", b.shipping.weight) ? gramsOf(b.shipping.weight) : null;
            const d = b.shipping.dimensions && checkFact(pg.norm, "Dimensions", b.shipping.dimensions) ? cmOf(b.shipping.dimensions) : null;
            if (w && !p.weightGrams) patch.weightGrams = w;
            else if (w && p.weightGrams && Math.abs(w - p.weightGrams) / p.weightGrams > 0.25) notes.push(`Weight: ours ${p.weightGrams} g, ${pg.site} says ${w} g — check (ours may include packing).`);
            if (d && !p.lengthCm) [patch.lengthCm, patch.breadthCm, patch.heightCm] = d;
            else if (d && p.lengthCm) notes.push(`Parcel size on ${pg.site}: ${d.join(" × ")} cm — ours is already filled, not changed.`);
            if (patch.weightGrams || patch.lengthCm) notes.push(`Weight / size taken from ${pg.site}, not weighed by us — add wrapper and packing weight if needed.`);
        }
    }

    // Photos: sure ones applied now, the rest left for staff.
    const gallery = galleryOf(p);
    const onPage = new Map(checked.trusted.flatMap((pg) => pg.photos.map((u) => [u, pg] as const)));
    const gone = new Set(b.photos.remove.map((r) => r.url).filter((u) => gallery.includes(u)));
    const wanted = b.photos.add.filter((x) => onPage.has(x.url) && !gallery.includes(x.url)).slice(0, AI_PHOTO_LIMITS.total);
    for (const x of b.photos.add) if (!onPage.has(x.url)) notes.push(`Photo not on a kept page — not added: ${x.url}`);
    // Copied into our Cloudinary first, as staff's Add does (AiPhotoPicker): the
    // shop and product page only show our own photo hosts, and the maker's link may move.
    const copyOf = new Map<string, string>();
    const failed: typeof wanted = [];
    for (const x of wanted) {
        const ours = await copyToOurPhotos(x.url);
        if (ours) copyOf.set(x.url, ours); else failed.push(x);
    }
    if (failed.length) notes.push(`${failed.length} photo(s) could not be copied to our storage — offered to add by hand instead.`);
    const added = wanted.filter((x) => copyOf.has(x.url));
    let next = [...gallery.filter((u) => !gone.has(u)), ...added.map((x) => copyOf.get(x.url)!)];
    const ordered = [...new Set(b.photos.order.map((u) => copyOf.get(u) ?? u).filter((u) => next.includes(u)))];
    if (ordered.length) next = [...ordered, ...next.filter((u) => !ordered.includes(u))];
    if (gone.size || added.length || ordered.length) {
        patch.galleryUrls = next;
        patch.imageUrl = next[0] ?? null;
        if (gone.size) notes.push(`Removed ${gone.size} wrong photo(s): ${b.photos.remove.filter((r) => gone.has(r.url)).map((r) => r.note || r.why).join("; ")}.`);
        if (added.length) notes.push(`Added ${added.length} photo(s) from ${[...new Set(added.map((x) => onPage.get(x.url)!.site))].join(", ")} — check they show this exact model and colour.`);
    }
    if (added.some((x) => !onPage.get(x.url)?.maker)) notes.push("Some added photos are from a seller's page, not the maker's.");
    const suggested: PhotoSuggestion[] = [...b.photos.suggest, ...failed]
        .filter((x) => onPage.has(x.url) && !next.includes(x.url))
        .map((x) => ({ url: x.url, site: onPage.get(x.url)!.site, kind: isPhotoKind(x.kind) ? x.kind : null }));
    const kinds = (xs: string[]) => xs.filter(isPhotoKind) as PhotoKind[];
    const ours = photosForAi(next);
    const nOf = (u: string) => ours.indexOf(u) + 1;
    const arrange = arrangeFrom({ order: [], look: b.photos.look.filter((x) => nOf(x.url) > 0).map((x) => ({ ...x, photo: nOf(x.url), crop: x.crop, focus: x.focus, background: x.background })) }, ours, new Set());

    const draft: ProductCopy = {
        ...checked.copy,
        note: `Written by Claude (product prep, from the saved search of ${s.at.slice(0, 10)}); ${checked.copy.note}`,
        notes: [...notes, SIGN(3)],
        photoChecklist: checklistFrom(
            kinds(b.photos.have), kinds(b.photos.must), kinds(b.photos.nice),
            b.photos.suggestRemove.filter((r) => next.includes(r.url) && r.why in PHOTO_REMOVE_REASONS).map((r) => ({ url: r.url, why: r.why as PhotoRemoveReason, note: r.note })),
        ),
        ...(arrange && { photoArrange: arrange }),
        photoSuggestions: suggested,
    };
    const shopStatus = await writeAsDraft(id, patch, () => ({ aiCopy: draft, notes: undefined, notesAt: undefined, kept: undefined }));
    await writeState(id, { ...state, part: 3, at: new Date().toISOString() });
    return {
        result: "part3" as const, shopStatus,
        kept: { specs: checked.copy.specs, highlights: checked.copy.highlights, warranty: checked.copy.warranty },
        unsure: checked.copy.unsure, flags: checked.copy.flags,
        photos: { removed: gone.size, added: added.length, ordered: ordered.length > 0, suggested: suggested.length },
        notes: draft.notes,
    };
}

// ── Part 4: verify (no internet) ──────────────────────────────────────────────

export const part4Schema = z.object({
    /** What is still wrong or not done. Empty = verified. */
    pending: lines,
    /** Small things that do not hold the product back. */
    notes: lines,
});

export async function savePart4(id: number, b: z.infer<typeof part4Schema>) {
    const exists = await prisma.invProduct.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AgentCopyError("Product not found");
    if (b.pending.length) {
        await parkInAttention([id], [...b.pending.map((x) => `PENDING (Part 4) — ${x}`), ...b.notes].join("\n").slice(0, 10000), "Claude", "any");
        return { result: "attention" as const, pending: b.pending.length };
    }
    const { state } = await liveState(id).catch(() => ({ state: null }));
    if (state) await writeState(id, { ...state, part: 4, at: new Date().toISOString() });
    await addDraftNotes(id, [...b.notes, "Part 4 done — verified, ready to Save as ready."]);
    return { result: "verified" as const };
}
