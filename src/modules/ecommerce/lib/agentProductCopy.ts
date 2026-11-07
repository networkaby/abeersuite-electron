import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";
import { AI_PHOTO_LIMITS } from "@/shared/lib/constants/ai";
import { OUTPUT_KEYS, type ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import { readShopDraft, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";
import { checkWrittenCopy, writtenCopySchema } from "@/modules/ecommerce/lib/aiVerifiedCopy";
import { readGivenPages } from "@/modules/ecommerce/lib/aiPageReader";
import { checkFact, normForCheck } from "@/modules/ecommerce/lib/aiFactCheck";
import { COMPATIBLE_SPEC } from "@/shared/lib/shop/compatibility";
import { PHOTO_KINDS, PHOTO_REMOVE_REASONS, checklistFrom, isPhotoKind, type PhotoKind, type PhotoRemoveReason, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

/**
 * Claude (Cowork / chat) runs the Verified steps itself — photo check, page
 * search, writing, photo advice — through /api/agent/products (owner,
 * 2026-11-07). The server keeps Step 4: it downloads Claude's pages itself and
 * checks every fact against them (checkWrittenCopy), exactly as for our own
 * AI. The result goes into the product's draft copy (shopDraftJson.aiCopy,
 * shopDraft.ts); staff review it on the product page, then Save as ready.
 * The stage is never changed and nothing here publishes. The skill is .claude/skills/product-copy/SKILL.md.
 */

const galleryOf = (p: { galleryJson: Prisma.JsonValue; imageUrl: string | null }) => productGalleryUrls(p.galleryJson, p.imageUrl);

// ── Backlog ───────────────────────────────────────────────────────────────────

const csv = z.string().trim().transform((v) => v.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.string()).max(50));
const yes = z.enum(["1", "true", "yes"]).transform(() => true);

export const backlogQuery = z.object({
    /** SKUs, comma separated — exactly these, in this order (stage / need ignored unless sent). */
    sku: csv.optional(),
    /** Words to find in the name, SKU or a barcode — like the Products search. */
    q: z.string().trim().min(2).max(100).optional(),
    /** Which shop stage (draft = a draft copy is open, any stage). Default: unpublished, or all when sku / q is sent. */
    stage: z.enum(["unpublished", "draft", "ready", "published", "all"]).optional(),
    /** copy = no description and no draft open yet; all = every product. Default: copy, or all when sku / q is sent. */
    need: z.enum(["copy", "all"]).optional(),
    /** At least this many photos usable by AI ("Skip for AI" ones not counted). */
    minPhotos: z.coerce.number().int().min(0).max(30).optional(),
    /** Only products with stock on hand (stock above 0). */
    inStock: yes.optional(),
    /** Brand / group name contains this. */
    brand: z.string().trim().min(1).max(100).optional(),
    group: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** Paging: the last id of the previous page (newest first). */
    before: z.coerce.number().int().positive().optional(),
});

/** Rows read per round while a photo count filters in memory (photos live in a JSON column). */
const SCAN_BATCH = 200;
const SCAN_MAX = 5000;

export async function productBacklog(q: z.infer<typeof backlogQuery>) {
    const named = !!(q.sku?.length || q.q);
    // A SKU list comes back whole, whatever limit says.
    const limit = q.sku?.length ? Math.max(q.limit, q.sku.length) : q.limit;
    const stage = q.stage ?? (named ? "all" : "unpublished");
    const need = q.need ?? (named ? "all" : "copy");
    const where: Prisma.InvProductWhereInput = {
        isActive: true,
        ...(q.sku?.length && { sku: { in: q.sku } }),
        ...(q.q && {
            AND: q.q.split(/\s+/).map((w) => ({
                OR: [
                    { name: { contains: w, mode: "insensitive" as const } },
                    { sku: { contains: w, mode: "insensitive" as const } },
                    { codes: { some: { value: { contains: w, mode: "insensitive" as const } } } },
                ],
            })),
        }),
        ...(stage === "draft" && { shopDraftAt: { not: null } }),
        ...(stage !== "all" && stage !== "draft" && { shopStatus: stage.toUpperCase() as ShopStatus }),
        ...(need === "copy" && { ...(stage !== "draft" && { shopDraftAt: null }), OR: [{ shopDescription: null }, { shopDescription: "" }] }),
        ...(q.inStock && { stock: { gt: 0 } }),
        ...(q.brand && { brand: { name: { contains: q.brand, mode: "insensitive" } } }),
        ...(q.group && { group: { name: { contains: q.group, mode: "insensitive" } } }),
    };
    const select = {
        id: true, sku: true, name: true, shopStatus: true, shopDescription: true, shopDraftAt: true, stock: true,
        imageUrl: true, galleryJson: true,
        brand: { select: { name: true } }, group: { select: { name: true } },
    } as const;
    type Row = Prisma.InvProductGetPayload<{ select: typeof select }>;
    const photoCount = (p: Row) => photosForAi(galleryOf(p)).length;

    // Newest first, a page at a time. The photo count is in JSON, so with
    // minPhotos rows are read in batches and filtered here until the page fills.
    const rows: Row[] = [];
    let before = q.before;
    let scanned = 0;
    let more = true;
    while (rows.length < limit && more && scanned < SCAN_MAX) {
        const take = q.minPhotos ? SCAN_BATCH : limit - rows.length;
        const batch = await prisma.invProduct.findMany({
            where: { ...where, ...(before && { id: { lt: before } }) },
            orderBy: { id: "desc" },
            take,
            select,
        });
        scanned += batch.length;
        more = batch.length === take;
        for (const p of batch) {
            before = p.id;
            if (q.minPhotos && photoCount(p) < q.minPhotos) continue;
            rows.push(p);
            if (rows.length === limit) break;
        }
    }
    // SKUs come back in the order they were asked for.
    if (q.sku?.length) rows.sort((a, b) => q.sku!.indexOf(a.sku.toUpperCase()) - q.sku!.indexOf(b.sku.toUpperCase()));
    const missing = q.sku?.filter((s) => !rows.some((p) => p.sku.toUpperCase() === s)) ?? [];

    return {
        products: rows.map((p) => ({
            id: p.id, sku: p.sku, name: p.name, brand: p.brand?.name ?? null, group: p.group?.name ?? null,
            shopStatus: p.shopStatus, hasDescription: !!p.shopDescription?.trim(),
            photos: photoCount(p), stock: p.stock,
            draftWaitingSince: p.shopDraftAt?.toISOString() ?? null,
        })),
        /** Asked-for SKUs not found (wrong SKU, inactive, or filtered out). */
        ...(missing.length && { notFound: missing }),
        nextBefore: rows.length === limit && more ? before ?? null : null,
    };
}

// ── One product: everything Step 1 needs ─────────────────────────────────────

// ── Brand / collection masters Claude may pick from (never creates) ────────────

const MASTERS_CACHE_MS = 5 * 60_000;
let mastersCache: { at: number; brands: { id: number; name: string }[]; collections: { id: number; path: string }[] } | null = null;

/** Active brands and every collection with its full path ("Computer › Accessories › USB Hub"), cached 5 min. */
async function pickableMasters() {
    if (mastersCache && Date.now() - mastersCache.at < MASTERS_CACHE_MS) return mastersCache;
    const [brands, cats] = await Promise.all([
        prisma.invBrand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.invCategory.findMany({ select: { id: true, name: true, parentId: true } }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const path = (id: number) => {
        const parts: string[] = [];
        for (let c = byId.get(id), n = 0; c && n < 10; c = c.parentId ? byId.get(c.parentId) : undefined, n++) parts.unshift(c.name);
        return parts.join(" › ");
    };
    mastersCache = {
        at: Date.now(),
        brands,
        collections: cats.map((c) => ({ id: c.id, path: path(c.id) })).sort((a, b) => a.path.localeCompare(b.path)),
    };
    return mastersCache;
}

export async function productForAgent(id: number) {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: {
            id: true, sku: true, name: true, modelNo: true, shopStatus: true, shopDescription: true, specsJson: true,
            imageUrl: true, galleryJson: true, shopCategory: true, shopDraftAt: true,
            codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
            brand: { select: { name: true } }, category: { select: { name: true } }, group: { select: { name: true } },
            warrantyTerm: { select: { durationDays: true } },
            collections: { select: { categoryId: true }, orderBy: { sortOrder: "asc" } },
        },
    });
    if (!p) return null;
    const masters = await pickableMasters();
    return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand?.name ?? null,
        category: p.shopCategory ?? p.group?.name ?? p.category?.name ?? null,
        modelNo: p.modelNo,
        /** The maker's EAN / UPC only — our own shop barcodes are not the maker's. */
        barcodes: p.codes.map((c) => c.value),
        /** Typed by staff earlier — may be wrong; a hint, never a fact. */
        typedSpecs: p.specsJson && typeof p.specsJson === "object" && !Array.isArray(p.specsJson) ? p.specsJson : null,
        /** OUR support period in days — never the maker's warranty, never written online. */
        shopSupportDays: p.warrantyTerm?.durationDays ?? null,
        shopStatus: p.shopStatus,
        currentDescription: p.shopDescription,
        draftWaitingSince: p.shopDraftAt?.toISOString() ?? null,
        /** Our gallery in order, "Skip for AI" photos left out. Look at every one. */
        photos: photosForAi(galleryOf(p)),
        /** The shop's house style and the exact keys of the written copy — same as our own AI's. */
        writing: OUTPUT_KEYS,
        /** Photo kinds for Step 5 (key → label). */
        photoKinds: Object.fromEntries(Object.entries(PHOTO_KINDS).map(([k, v]) => [k, v.label])),
        photoRemoveReasons: Object.keys(PHOTO_REMOVE_REASONS),
        /** Collections set now, main first — Claude only adds to these. */
        currentCollections: p.collections.map((c) => ({ id: c.categoryId, path: masters.collections.find((x) => x.id === c.categoryId)?.path ?? String(c.categoryId) })),
        /** The masters to pick brandId / collectionIds from. Missing one? Say so in notes — never invent an id. */
        masters: { brands: masters.brands, collections: masters.collections },
    };
}

// ── Claude's draft in, Step 4, saved as a draft ───────────────────────────────

const record = z.record(z.string(), z.coerce.string()).default({});

export const agentCopySchema = z.object({
    /** Step 1: facts PRINTED on the product / box / label (label → value, as printed). */
    labelFacts: record,
    /** Step 1: things only visible in a photo, counts worded "at least N". */
    seen: record,
    /** Website printed on the box, if any — it counts as the maker's site. */
    labelWebsite: z.string().trim().max(200).default(""),
    /** Step 2: every page Claude read, accepted or not, with why. Read again here. */
    pages: z.array(z.object({
        url: z.string().url(),
        accepted: z.boolean(),
        why: z.string().trim().max(300).default(""),
    })).max(8).default([]),
    /**
     * Step 3: the written copy, keys as `writing` says, plus specSources
     * (spec label → "label" or the page url it came from) and dataFlags.
     */
    copy: z.record(z.string(), z.unknown()),
    /** Brand from masters.brands — used only when the product has no brand yet. */
    brandId: z.number().int().positive().optional(),
    /** Collections from masters.collections to ADD; the ones set now are kept, the main one stays. */
    collectionIds: z.array(z.number().int().positive()).max(10).optional(),
    /** Anything staff should fix: a brand / collection to create, a spelling mistake in our data, a wrong group… */
    notes: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    /**
     * Photos Claude picked from the accepted pages, best first, with the kind each
     * fills. Kept only when the photo really is on an accepted page (the server's
     * read of it); offered to staff to add — never put in the gallery by itself.
     */
    photoPicks: z.array(z.object({ url: z.string().url(), kind: z.string().optional() })).max(15).default([]),
    /**
     * For the courier quote: the PACKAGE weight and size (else the product's own),
     * quoted exactly as the source prints them ("~0.05 kg", "116.26 x 36.46 x 100.94 mm"),
     * with the source ("label" or the page url). The server finds the text on the
     * source, converts it itself (grams, whole cm rounded up), and fills the draft
     * only where the product has none.
     */
    shipping: z.object({
        weight: z.string().trim().max(60).optional(),
        dimensions: z.string().trim().max(80).optional(),
        source: z.string().trim().max(500),
    }).optional(),
    /** Step 5 (optional): photo kinds as photoKinds keys, and our photos to remove. */
    photos: z.object({
        have: z.array(z.string()).default([]),
        must: z.array(z.string()).default([]),
        nice: z.array(z.string()).default([]),
        remove: z.array(z.object({ url: z.string().url(), why: z.string(), note: z.string().max(200).default("") })).max(30).default([]),
    }).optional(),
});

export class AgentCopyError extends Error {}

export async function saveAgentCopy(id: number, body: z.infer<typeof agentCopySchema>): Promise<{ draft: ProductCopy; shopStatus: ShopStatus }> {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: {
            name: true, modelNo: true, shopStatus: true, imageUrl: true, galleryJson: true, shopDraftJson: true,
            shopSubheading: true, shopDescription: true, specsJson: true,
            weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true,
            brandId: true, brand: { select: { name: true } },
            collections: { select: { categoryId: true }, orderBy: { sortOrder: "asc" } },
            codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
        },
    });
    if (!p) throw new AgentCopyError("Product not found");

    // Step 2 again, by us: the same maker / seller rule and barcode drop as our own search.
    const codes = [...p.codes.map((c) => c.value), ...(p.modelNo ? [p.modelNo] : [])];
    const found = await readGivenPages({
        urls: body.pages.map((x) => x.url),
        brand: p.brand?.name ?? p.name.split(/\s+/)[0] ?? "",
        labelSite: body.labelWebsite,
        codes,
    });
    // Pages are lettered in the order we read them; Claude names them by url.
    const letterOf = new Map(found.pages.map((pg, i) => [pg.url, String.fromCharCode(65 + i)]));
    const raw = body.copy as Record<string, unknown>;
    const sources = raw.specSources && typeof raw.specSources === "object" ? (raw.specSources as Record<string, unknown>) : {};
    const written = writtenCopySchema.safeParse({
        ...raw,
        pages: found.pages.map((pg, i) => {
            const said = body.pages.find((x) => x.url === pg.url);
            return { page: String.fromCharCode(65 + i), accepted: !!said?.accepted, why: said?.why ?? "" };
        }),
        specSources: Object.fromEntries(Object.entries(sources).map(([k, v]) => {
            const s = String(v ?? "").trim();
            return [k, s.toLowerCase() === "label" ? "label" : letterOf.get(s) ?? ""];
        })),
    });
    if (!written.success) throw new AgentCopyError(`copy does not match the keys in "writing": ${written.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);

    const checked = checkWrittenCopy(p.name, body, found, written.data);
    const gallery = galleryOf(p);
    const kinds = (xs: string[]) => xs.filter(isPhotoKind) as PhotoKind[];
    // Brand / collections: only ids that exist; brand fills a blank one only; collections are added.
    const masters = await pickableMasters();
    const notes = [...body.notes];
    const open = readShopDraft(p.shopDraftJson);
    const masterPatch: ShopDraft["patch"] = {};
    if (body.brandId) {
        const b = masters.brands.find((x) => x.id === body.brandId);
        if (!b) notes.push(`Brand id ${body.brandId} is not an active brand — not set.`);
        else if (p.brandId && p.brandId !== b.id) notes.push(`Brand left as "${p.brand?.name}" — Claude suggests "${b.name}". Check which is right.`);
        else if (!p.brandId) {
            masterPatch.brandId = b.id;
            notes.push(`Brand "${b.name}" set in the draft — after Save as ready, rebuild the name with ⟳ / Deep edit if needed.`);
        }
    }
    if (body.collectionIds?.length) {
        const now = open?.patch.collectionIds ?? p.collections.map((c) => c.categoryId);
        const unknown = body.collectionIds.filter((id) => !masters.collections.some((c) => c.id === id));
        if (unknown.length) notes.push(`Collection id ${unknown.join(", ")} does not exist — not added.`);
        const added = body.collectionIds.filter((id) => !unknown.includes(id) && !now.includes(id));
        if (added.length) {
            masterPatch.collectionIds = [...now, ...added];
            notes.push(`Collections added in the draft: ${added.map((id) => masters.collections.find((c) => c.id === id)?.path).join("; ")}.`);
        }
    }

    // A pick counts only when an accepted page really shows it (maker's photos are the safest).
    const onPage = new Map(checked.trusted.flatMap((pg) => pg.photos.map((u) => [u, pg] as const)));
    const picked: PhotoSuggestion[] = [];
    for (const x of body.photoPicks) {
        const pg = onPage.get(x.url);
        if (!pg) { notes.push(`Photo not found on an accepted page — not suggested: ${x.url}`); continue; }
        picked.push({ url: x.url, site: pg.site, kind: isPhotoKind(x.kind) ? x.kind : null });
    }
    picked.sort((a, b) => Number(onPage.get(b.url)?.maker) - Number(onPage.get(a.url)?.maker));
    if (picked.some((x) => !onPage.get(x.url)?.maker)) notes.push("Some suggested photos are from a seller's page, not the maker's — check they are the maker's own before adding.");

    const draft: ProductCopy = {
        ...checked.copy,
        note: `Written by Claude; ${checked.copy.note}`,
        ...(notes.length && { notes }),
        ...(body.photos && {
            photoChecklist: checklistFrom(
                kinds(body.photos.have), kinds(body.photos.must), kinds(body.photos.nice),
                body.photos.remove
                    .filter((r) => gallery.includes(r.url) && r.why in PHOTO_REMOVE_REASONS)
                    .map((r) => ({ url: r.url, why: r.why as PhotoRemoveReason, note: r.note })),
            ),
        }),
        // Photos on the pages the copy kept — free; staff pick on the product page.
        // Claude's picks first (with their kind), then the rest the kept pages name.
        photoSuggestions: [...picked, ...checked.trusted.flatMap((pg) => pg.photos.map((url) => ({ url, site: pg.site, kind: null })))]
            .filter((x, i, all) => !gallery.includes(x.url) && all.findIndex((y) => y.url === x.url) === i)
            .slice(0, AI_PHOTO_LIMITS.total),
    };
    // Into the product's draft copy (shopDraft.ts), beside any edits staff have
    // open there. The stage is not touched: the shop keeps the finished version.
    // The copy goes into the draft's fields too, so the product page opens with it
    // filled in. Never over staff (owner's rule: auto-fill fills blanks only):
    // a field staff typed — on the product or already in this draft — stays, and
    // the AI version waits beside it with a Use button.
    const was = { ...{ shopSubheading: p.shopSubheading, shopDescription: p.shopDescription, specs: specsOf(p.specsJson) }, ...open?.patch };
    const copyPatch: ShopDraft["patch"] = {};
    if (!was.shopDescription?.trim()) copyPatch.shopDescription = draft.shopDescription;
    const sub = was.shopSubheading?.trim();
    if (!sub || sub === p.name.trim()) copyPatch.shopSubheading = draft.title;
    const have = was.specs ?? {};
    const lower = new Set(Object.keys(have).map((k) => k.trim().toLowerCase()));
    // The checked compatible list also as its own spec — the shop's "Works with" rows and search read it.
    const compatList = draft.compatibility.flatMap((g) => g.models);
    const withCompat: Record<string, string> = { ...draft.specs, ...(compatList.length && { [COMPATIBLE_SPEC]: compatList.join(", ") }) };
    const added = Object.entries(withCompat).filter(([k, v]) => v.trim() && !lower.has(k.trim().toLowerCase()));
    if (added.length) copyPatch.specs = { ...have, ...Object.fromEntries(added) };

    // Shipping weight / parcel size — blanks only, and only what the source really prints.
    if (body.shipping) {
        const src = body.shipping.source.trim();
        const srcNorm = src.toLowerCase() === "label"
            ? normForCheck([...Object.entries(body.labelFacts).flat(), ...Object.entries(body.seen).flat()].join(" "))
            : found.pages.find((pg) => pg.url === src && checked.trusted.includes(pg))?.norm;
        const blank = (k: "weightGrams" | "lengthCm" | "breadthCm" | "heightCm") => (open?.patch[k] ?? p[k]) == null;
        if (!srcNorm) notes.push(`Shipping size not used: "${src}" is not the label or an accepted page.`);
        else {
            const w = body.shipping.weight && checkFact(srcNorm, "Weight", body.shipping.weight) ? gramsOf(body.shipping.weight) : null;
            if (body.shipping.weight && w == null) notes.push(`Shipping weight "${body.shipping.weight}" not confirmed on the source — not filled.`);
            if (w && blank("weightGrams")) copyPatch.weightGrams = w;
            const d = body.shipping.dimensions && checkFact(srcNorm, "Dimensions", body.shipping.dimensions) ? cmOf(body.shipping.dimensions) : null;
            if (body.shipping.dimensions && !d) notes.push(`Parcel size "${body.shipping.dimensions}" not confirmed on the source — not filled.`);
            if (d && blank("lengthCm") && blank("breadthCm") && blank("heightCm")) {
                [copyPatch.lengthCm, copyPatch.breadthCm, copyPatch.heightCm] = d;
            }
            if (copyPatch.weightGrams || copyPatch.lengthCm) {
                notes.push(`Shipping filled in the draft: ${copyPatch.weightGrams ? `${copyPatch.weightGrams} g` : ""}${copyPatch.weightGrams && copyPatch.lengthCm ? ", " : ""}${copyPatch.lengthCm ? `${copyPatch.lengthCm} × ${copyPatch.breadthCm} × ${copyPatch.heightCm} cm` : ""} (from ${src.toLowerCase() === "label" ? "the label" : new URL(src).hostname}).`);
            }
        }
    }
    const next: ShopDraft = { patch: { ...open?.patch, ...masterPatch, ...copyPatch }, aiCopy: draft, ...(open?.notes && { notes: open.notes }) };
    await prisma.invProduct.update({
        where: { id },
        data: { shopDraftJson: next as unknown as Prisma.InputJsonValue, shopDraftAt: new Date() },
    });
    return { draft, shopStatus: p.shopStatus };
}


// ── Read one page for Claude when a site blocks it ────────────────────────────

export const readPageSchema = z.object({
    /** The product being worked on — its brand decides which site is the maker's. */
    productId: z.number().int().positive(),
    url: z.string().url(),
    /** Website printed on the box, if any — counts as the maker's. */
    labelWebsite: z.string().trim().max(200).default(""),
});

/**
 * Claude was blocked by a site (rate limit, bot check, a page built in the
 * browser): the server reads it through the same path as its own check —
 * a plain download, then the "Read page" keys on AI Setup (Scrape.do …), free
 * keys first, within their limits. Only the maker's site or a known seller,
 * never a private address: not an open scraper. Same answer as Step 4 sees.
 */
export async function readPageForAgent(b: z.infer<typeof readPageSchema>) {
    const p = await prisma.invProduct.findUnique({
        where: { id: b.productId },
        select: { name: true, modelNo: true, brand: { select: { name: true } }, codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } } },
    });
    if (!p) throw new AgentCopyError("Product not found");
    const found = await readGivenPages({
        urls: [b.url],
        brand: p.brand?.name ?? p.name.split(/\s+/)[0] ?? "",
        labelSite: b.labelWebsite,
        codes: [...p.codes.map((c) => c.value), ...(p.modelNo ? [p.modelNo] : [])],
    });
    const pg = found.pages[0];
    if (!pg) return { read: false as const, why: found.dropped[0] ?? found.searchNote ?? "Could not read the page" };
    return {
        read: true as const,
        site: pg.site,
        /** The maker's own site (or the one on the box), not a seller. */
        maker: pg.maker,
        /** Our barcode / model code is on the page — the same product. */
        codeMatch: pg.codeMatch,
        /** The product part of the page text (menus cut). */
        text: pg.text,
        /** Product photos the page names — send the right ones back as photoPicks. */
        photos: pg.photos,
    };
}

/** InvProduct.specsJson as label → text (null when empty or not an object). */
function specsOf(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}

/** "~0.05 kg" / "50 g" / "1.2kg" → whole grams (rounded up); null when no weight is in the text. */
function gramsOf(text: string): number | null {
    const m = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?)\b/i.exec(text.replace(/,/g, ""));
    if (!m) return null;
    const g = Number(m[1]) * (m[2].toLowerCase().startsWith("k") ? 1000 : 1);
    return g > 0 && g <= 1_000_000 ? Math.ceil(g) : null;
}

/** "116.26 x 36.46 x 100.94 mm" → [12, 4, 11] whole cm (rounded up); null when not three sizes. */
function cmOf(text: string): [number, number, number] | null {
    const m = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)?/i.exec(text.replace(/,/g, ""));
    if (!m) return null;
    const unit = (m[4] ?? "cm").toLowerCase();
    const f = unit === "mm" ? 0.1 : unit.startsWith("in") ? 2.54 : 1;
    const out = [m[1], m[2], m[3]].map((x) => Math.ceil(Number(x) * f)) as [number, number, number];
    return out.every((x) => x > 0 && x <= 1000) ? out : null;
}

// ── Review mode: notes only ───────────────────────────────────────────────────

export const notesSchema = z.object({
    notes: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
    /** true = replace the review notes already there (a fresh review); default adds to them. */
    replace: z.boolean().default(false),
});

/**
 * Claude reviewed a product (finished copy, staff's or its own) and only leaves
 * notes — nothing on the product changes. They go into the product's draft copy,
 * so the product shows in the Draft tab with "Notes for you" until staff fix
 * them and Save as ready, or Discard.
 */
export async function addReviewNotes(id: number, b: z.infer<typeof notesSchema>) {
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { shopDraftJson: true } });
    if (!p) throw new AgentCopyError("Product not found");
    const open = readShopDraft(p.shopDraftJson);
    const notes = [...new Set([...(b.replace ? [] : open?.notes ?? []), ...b.notes])].slice(-50);
    const next: ShopDraft = { patch: open?.patch ?? {}, ...(open?.aiCopy && { aiCopy: open.aiCopy }), notes };
    await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: next as unknown as Prisma.InputJsonValue, shopDraftAt: new Date() } });
    return { notes: notes.length };
}

// ── Compatibility only ────────────────────────────────────────────────────────

export const compatSchema = z.object({
    /** The maker's (or seller's) pages with the list — read again by the server. */
    pages: z.array(z.object({ url: z.string().url(), accepted: z.boolean(), why: z.string().trim().max(300).default("") })).min(1).max(8),
    labelWebsite: z.string().trim().max(200).default(""),
    /** Exact model names as the page lists them ("HP Smart Tank 580"). */
    models: z.array(z.string().trim().min(2).max(120)).min(1).max(200),
});

/**
 * "Do compatibility for all ink, toner and printheads": only the product's
 * compatible list, refreshed from the maker's page — replaced, not added to
 * (owner's call: the maker's current list is the truth; it is only a draft).
 * Every model must be on an accepted page (the server reads it); the kept list
 * goes into the draft as the "Compatible Models" spec. Nothing else changes.
 */
export async function saveCompatibility(id: number, b: z.infer<typeof compatSchema>) {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: { name: true, modelNo: true, specsJson: true, shopDraftJson: true, brand: { select: { name: true } }, codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } } },
    });
    if (!p) throw new AgentCopyError("Product not found");
    const found = await readGivenPages({
        urls: b.pages.map((x) => x.url),
        brand: p.brand?.name ?? p.name.split(/\s+/)[0] ?? "",
        labelSite: b.labelWebsite,
        codes: [...p.codes.map((c) => c.value), ...(p.modelNo ? [p.modelNo] : [])],
    });
    const accepted = found.pages.filter((pg) => pg.codeMatch || b.pages.find((x) => x.url === pg.url)?.accepted);
    if (!accepted.length) throw new AgentCopyError(`No accepted page could be read (${[...found.dropped, found.searchNote].filter(Boolean).join("; ") || "none"}) — nothing saved.`);
    const kept = [...new Set(b.models.filter((m) => accepted.some((pg) => checkFact(pg.norm, "Compatible", m))))];
    const dropped = b.models.filter((m) => !kept.includes(m));
    if (!kept.length) throw new AgentCopyError("None of the models is on the accepted pages — nothing saved.");

    const open = readShopDraft(p.shopDraftJson);
    const base = open?.patch.specs ?? specsOf(p.specsJson) ?? {};
    const specs = Object.fromEntries(Object.entries(base).filter(([k]) => !/^compatib/i.test(k.trim())));
    specs[COMPATIBLE_SPEC] = kept.join(", ");
    const note = `Compatible models refreshed from ${accepted.map((pg) => pg.site).join(", ")}: ${kept.length} kept${dropped.length ? `, ${dropped.length} dropped (not on the page): ${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? "…" : ""}` : ""}.`;
    const next: ShopDraft = {
        patch: { ...open?.patch, specs },
        ...(open?.aiCopy && { aiCopy: open.aiCopy }),
        notes: [...(open?.notes ?? []).filter((n) => !n.startsWith("Compatible models refreshed")), note],
    };
    await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: next as unknown as Prisma.InputJsonValue, shopDraftAt: new Date() } });
    return { kept, dropped, sources: accepted.map((pg) => ({ site: pg.site, url: pg.url, codeMatch: pg.codeMatch })) };
}
