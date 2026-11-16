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
import { updateShopProduct, type ShopProductPatch } from "@/modules/ecommerce/lib/updateShopProduct";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";
import { PHOTO_LOOK_OPTIONS, arrangeFrom, checkWrittenCopy, writtenCopySchema } from "@/modules/ecommerce/lib/aiVerifiedCopy";
import { readGivenPages } from "@/modules/ecommerce/lib/aiPageReader";
import { checkFact, cmOf, gramsOf, normForCheck } from "@/modules/ecommerce/lib/aiFactCheck";
import { COMPATIBLE_SPEC } from "@/shared/lib/shop/compatibility";
import { PHOTO_KINDS, PHOTO_REMOVE_REASONS, checklistFrom, isPhotoKind, type PhotoKind, type PhotoRemoveReason, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

/**
 * Claude (Cowork / chat) runs the Verified steps itself — photo check, page
 * search, writing, photo advice — through /api/agent/products (owner,
 * 2026-11-07). The server keeps Step 4: it downloads Claude's pages itself and
 * checks every fact against them (checkWrittenCopy), exactly as for our own
 * AI. The checked copy is written straight onto the product and the product
 * moves to Draft (owner, 2026-11-10: one copy, Claude overwrites) — off the
 * shop until staff review it and Save as ready; Claude's notes and photo advice
 * sit beside it (shopDraftJson.aiCopy). Nothing here publishes. The skill is .claude/skills/product-copy/SKILL.md.
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
    /** Which shop stage. Default: unpublished, or all when sku / q is sent. */
    stage: z.enum(["unpublished", "waiting", "draft", "attention", "ready", "published", "all"]).optional(),
    /** copy = no description yet; all = every product. Default: copy, or all when sku / q is sent. */
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
        ...(stage !== "all" && { shopStatus: stage.toUpperCase() as ShopStatus }),
        ...(need === "copy" && { OR: [{ shopDescription: null }, { shopDescription: "" }] }),
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
export async function pickableMasters() {
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
        /** Step 5 "look" choices — the same list our own photo AI picks from. */
        photoLookOptions: PHOTO_LOOK_OPTIONS,
        /** Each photo through our own server — use it when the photo host is blocked for you. n = 1-based place in photos. */
        photoProxy: `/api/agent/products/${p.id}/photos/{n}`,
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
    notes: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
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
        /** Our photos (urls) in the best order, removed ones left out — product front first. Same rule as our photo AI. */
        order: z.array(z.string().url()).max(30).default([]),
        /** Photos that would show better in the shop's frames — choices from photoLookOptions. Staff press Use / Undo. */
        look: z.array(z.object({
            url: z.string().url(),
            crop: z.string().optional(),
            focus: z.string().optional(),
            fixes: z.array(z.string()).default([]),
            rotate: z.coerce.number().catch(0).default(0),
            background: z.string().optional(),
            why: z.string().trim().max(120).default(""),
        })).max(30).default([]),
    }).optional(),
});

export class AgentCopyError extends Error {}

export async function saveAgentCopy(id: number, body: z.infer<typeof agentCopySchema>): Promise<{ draft: ProductCopy; shopStatus: ShopStatus }> {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: {
            name: true, modelNo: true, shopStatus: true, imageUrl: true, galleryJson: true,
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
    // Brand / collections: only ids that exist. Claude's brand replaces ours
    // (owner, 2026-11-10: Claude writes straight onto the product); collections are added.
    const masters = await pickableMasters();
    const notes = [...body.notes];
    const masterPatch: ShopProductPatch = {};
    if (body.brandId) {
        const b = masters.brands.find((x) => x.id === body.brandId);
        if (!b) notes.push(`Brand id ${body.brandId} is not an active brand — not set.`);
        else if (p.brandId !== b.id) {
            masterPatch.brandId = b.id;
            notes.push(`Brand set to "${b.name}"${p.brand?.name ? ` (was "${p.brand.name}")` : ""} — rebuild the name with ⟳ / Deep edit if needed.`);
        }
    }
    if (body.collectionIds?.length) {
        const now = p.collections.map((c) => c.categoryId);
        const unknown = body.collectionIds.filter((id) => !masters.collections.some((c) => c.id === id));
        if (unknown.length) notes.push(`Collection id ${unknown.join(", ")} does not exist — not added.`);
        const added = body.collectionIds.filter((id) => !unknown.includes(id) && !now.includes(id));
        if (added.length) {
            masterPatch.collectionIds = [...now, ...added];
            notes.push(`Collections added: ${added.map((id) => masters.collections.find((c) => c.id === id)?.path).join("; ")}.`);
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

    // Step 5's order and looks, through the same check as our photo AI (arrangeFrom).
    const ours = photosForAi(gallery);
    const removed = new Set((body.photos?.remove ?? []).map((r) => r.url));
    const nOf = (u: string) => ours.indexOf(u) + 1;
    const arrange = body.photos && arrangeFrom({
        order: body.photos.order.map(nOf).filter((n) => n > 0),
        look: body.photos.look.filter((x) => nOf(x.url) > 0).map((x) => ({ ...x, photo: nOf(x.url), crop: x.crop, focus: x.focus, background: x.background })),
    }, ours, removed);
    // Claude runs the steps itself — a draft with no page read is said plainly, so staff know.
    if (!body.pages.length) notes.push("No maker or seller page was read for this draft — the copy is from the label and photos only.");

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
        ...(arrange && { photoArrange: arrange }),
        // Photos on the pages the copy kept — free; staff pick on the product page.
        // Claude's picks first (with their kind), then the rest the kept pages name.
        photoSuggestions: [...picked, ...checked.trusted.flatMap((pg) => pg.photos.map((url) => ({ url, site: pg.site, kind: null })))]
            .filter((x, i, all) => !gallery.includes(x.url) && all.findIndex((y) => y.url === x.url) === i)
            .slice(0, AI_PHOTO_LIMITS.total),
    };
    // Straight onto the product (owner, 2026-11-10: one copy, Claude overwrites),
    // and the product moves to Draft — off the shop until staff Save as ready.
    // Claude's own text replaces ours; the server-checked copy is all that goes on.
    const copyPatch: ShopProductPatch = { shopDescription: draft.shopDescription, shopSubheading: draft.title };
    // Specs: Claude's rows replace ours with the same label; our other rows stay.
    // The checked compatible list also as its own spec — the shop's "Works with" rows and search read it.
    const compatList = draft.compatibility.flatMap((g) => g.models);
    const withCompat = Object.entries({ ...draft.specs, ...(compatList.length && { [COMPATIBLE_SPEC]: compatList.join(", ") }) }).filter(([, v]) => v.trim());
    if (withCompat.length) {
        const theirs = new Set(withCompat.map(([k]) => k.trim().toLowerCase()));
        copyPatch.specs = { ...Object.fromEntries(Object.entries(specsOf(p.specsJson) ?? {}).filter(([k]) => !theirs.has(k.trim().toLowerCase()))), ...Object.fromEntries(withCompat) };
    }

    // Shipping weight / parcel size — only what the source really prints.
    if (body.shipping) {
        const src = body.shipping.source.trim();
        const srcNorm = src.toLowerCase() === "label"
            ? normForCheck([...Object.entries(body.labelFacts).flat(), ...Object.entries(body.seen).flat()].join(" "))
            : found.pages.find((pg) => pg.url === src && checked.trusted.includes(pg))?.norm;
        if (!srcNorm) notes.push(`Shipping size not used: "${src}" is not the label or an accepted page.`);
        else {
            const w = body.shipping.weight && checkFact(srcNorm, "Weight", body.shipping.weight) ? gramsOf(body.shipping.weight) : null;
            if (body.shipping.weight && w == null) notes.push(`Shipping weight "${body.shipping.weight}" not confirmed on the source — not filled.`);
            if (w) copyPatch.weightGrams = w;
            const d = body.shipping.dimensions && checkFact(srcNorm, "Dimensions", body.shipping.dimensions) ? cmOf(body.shipping.dimensions) : null;
            if (body.shipping.dimensions && !d) notes.push(`Parcel size "${body.shipping.dimensions}" not confirmed on the source — not filled.`);
            if (d) {
                [copyPatch.lengthCm, copyPatch.breadthCm, copyPatch.heightCm] = d;
            }
            if (copyPatch.weightGrams || copyPatch.lengthCm) {
                notes.push(`Shipping set: ${copyPatch.weightGrams ? `${copyPatch.weightGrams} g` : ""}${copyPatch.weightGrams && copyPatch.lengthCm ? ", " : ""}${copyPatch.lengthCm ? `${copyPatch.lengthCm} × ${copyPatch.breadthCm} × ${copyPatch.heightCm} cm` : ""} (from ${src.toLowerCase() === "label" ? "the label" : new URL(src).hostname}).`);
            }
        }
    }
    const shopStatus = await writeAsDraft(id, { ...masterPatch, ...copyPatch }, (info) => ({
        aiCopy: draft,
        // A fresh run replaces the notes kept from the last review.
        ...(info?.kept && { notes: undefined, notesAt: undefined, kept: undefined }),
    }));
    return { draft, shopStatus };
}

/**
 * Everything Claude does lands on the one product row and moves it to Draft
 * (owner, 2026-11-10) — off the shop until staff Save as ready; Discard draft
 * puts the stage back. `extra` adds Claude's notes / copy beside it.
 */
export async function writeAsDraft(id: number, fields: ShopProductPatch, extra: (info: ShopDraft | null) => Partial<ShopDraft>): Promise<ShopStatus> {
    const saved = await updateShopProduct(id, { ...fields, draft: "save" });
    if (saved.response) {
        const err = (await saved.response.json().catch(() => null)) as { error?: string } | null;
        throw new AgentCopyError(err?.error ?? "Could not save the product");
    }
    const row = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { shopDraftJson: true } });
    const info = readShopDraft(row.shopDraftJson);
    const next: ShopDraft = { ...info, ...extra(info) };
    await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: next as unknown as Prisma.InputJsonValue } });
    return saved.product.shopStatus;
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
        /** This listing's own price (₹) from the page's product data; null = not found — never take one from the text. */
        price: pg.price,
        /** In stock per the page's product data; null = not said. */
        inStock: pg.inStock,
    };
}

/** InvProduct.specsJson as label → text (null when empty or not an object). */
export function specsOf(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}

// ── Review mode: notes only ───────────────────────────────────────────────────

export const notesSchema = z.object({
    notes: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
    /** true = replace the review notes already there (a fresh review); default adds to them. */
    replace: z.boolean().default(false),
});

/**
 * Claude reviewed a product (or stopped on a clash) and only leaves notes — no
 * field changes. The product is parked in Attention with the notes as its
 * reason (owner, 2026-11-11), off the shop, until staff check it and Save as
 * draft or Save as ready. One note per line.
 */
export async function addReviewNotes(id: number, b: z.infer<typeof notesSchema>) {
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { shopAttention: true } });
    if (!p) throw new AgentCopyError("Product not found");
    const before = b.replace ? [] : (p.shopAttention ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    const notes = [...new Set([...before, ...b.notes])].slice(-30);
    await parkInAttention([id], notes.join("\n").slice(0, 10000), "Claude", "any");
    // A new review replaces the notes kept from the last one.
    const row = await prisma.invProduct.findUnique({ where: { id }, select: { shopDraftJson: true } });
    const info = readShopDraft(row?.shopDraftJson);
    if (info?.kept) {
        const { stageBefore, aiCopy } = info;
        await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: { ...(stageBefore && { stageBefore }), ...(aiCopy && { aiCopy }) } as unknown as Prisma.InputJsonValue } });
    }
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
 * (owner's call: the maker's current list is the truth).
 * Every model must be on an accepted page (the server reads it); the kept list
 * goes on the product as the "Compatible Models" spec, and it moves to Draft.
 */
export async function saveCompatibility(id: number, b: z.infer<typeof compatSchema>) {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: { name: true, modelNo: true, specsJson: true, brand: { select: { name: true } }, codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } } },
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

    const base = specsOf(p.specsJson) ?? {};
    const specs = Object.fromEntries(Object.entries(base).filter(([k]) => !/^compatib/i.test(k.trim())));
    specs[COMPATIBLE_SPEC] = kept.join(", ");
    const note = `Compatible models refreshed from ${accepted.map((pg) => pg.site).join(", ")}: ${kept.length} kept${dropped.length ? `, ${dropped.length} dropped (not on the page): ${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? "…" : ""}` : ""}.`;
    await writeAsDraft(id, { specs }, (open) => ({
        notes: [...(open?.notes ?? []).filter((n) => !n.startsWith("Compatible models refreshed")), note],
    }));
    return { kept, dropped, sources: accepted.map((pg) => ({ site: pg.site, url: pg.url, codeMatch: pg.codeMatch })) };
}
