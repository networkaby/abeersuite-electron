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
import { PHOTO_KINDS, PHOTO_REMOVE_REASONS, checklistFrom, isPhotoKind, type PhotoKind, type PhotoRemoveReason } from "@/modules/ecommerce/lib/photoChecklist";

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

export async function productForAgent(id: number) {
    const p = await prisma.invProduct.findUnique({
        where: { id },
        select: {
            id: true, sku: true, name: true, modelNo: true, shopStatus: true, shopDescription: true, specsJson: true,
            imageUrl: true, galleryJson: true, shopCategory: true, shopDraftAt: true,
            codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
            brand: { select: { name: true } }, category: { select: { name: true } }, group: { select: { name: true } },
            warrantyTerm: { select: { durationDays: true } },
        },
    });
    if (!p) return null;
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
            codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
            brand: { select: { name: true } },
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
    const draft: ProductCopy = {
        ...checked.copy,
        note: `Written by Claude; ${checked.copy.note}`,
        ...(body.photos && {
            photoChecklist: checklistFrom(
                kinds(body.photos.have), kinds(body.photos.must), kinds(body.photos.nice),
                body.photos.remove
                    .filter((r) => gallery.includes(r.url) && r.why in PHOTO_REMOVE_REASONS)
                    .map((r) => ({ url: r.url, why: r.why as PhotoRemoveReason, note: r.note })),
            ),
        }),
        // Photos on the pages the copy kept — free; staff pick on the product page.
        photoSuggestions: checked.trusted
            .flatMap((pg) => pg.photos.map((url) => ({ url, site: pg.site, kind: null })))
            .filter((x, i, all) => !gallery.includes(x.url) && all.findIndex((y) => y.url === x.url) === i)
            .slice(0, AI_PHOTO_LIMITS.total),
    };
    // Into the product's draft copy (shopDraft.ts), beside any edits staff have
    // open there. The stage is not touched: the shop keeps the finished version.
    const open = readShopDraft(p.shopDraftJson);
    const next: ShopDraft = { patch: open?.patch ?? {}, aiCopy: draft };
    await prisma.invProduct.update({
        where: { id },
        data: { shopDraftJson: next as unknown as Prisma.InputJsonValue, shopDraftAt: new Date() },
    });
    return { draft, shopStatus: p.shopStatus };
}

