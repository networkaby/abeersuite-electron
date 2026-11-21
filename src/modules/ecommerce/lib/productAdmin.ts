import type { InvProduct } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";

/**
 * What a product in the DRAFT stage carries beside its fields
 * (InvProduct.shopDraftJson). Draft is a stage on the one product row (owner,
 * 2026-11-10: "only one copy no parallel") — this is never a second copy.
 */
export type ShopDraft = {
    /** The stage it was in before Save as draft — Discard draft goes back to it. */
    stageBefore?: ShopStatus;
    /** Claude's Verified copy: already written onto the product; kept for its notes and photo advice. */
    aiCopy?: ProductCopy;
    /** Review notes (Claude's review mode, /api/agent/products/[id]/notes) — things for staff to fix. */
    notes?: string[];
    /** When those notes were written (ISO). */
    notesAt?: string;
    /** Notes kept after the product left Draft / Attention (owner, 2026-11-12) — shown until the next AI review replaces them. */
    kept?: boolean;
    /** Product prep's last 10 runs (owner, 2026-11-20) — the skills skip a part that already ran with nothing changed since. */
    runs?: PrepRun[];
    /**
     * The one shared open-problem list (owner, 2026-11-20): any part adds what it
     * finds and removes what it fixes; staff add theirs as {…} in the manual note.
     * Set-aside ones ("can't fix now") stay until fixed but never block.
     */
    problems?: PrepProblem[];
    /** How many problems are set aside — the products list's "Set aside" tab reads only this. */
    asideCount?: number;
    /** The manual note (owner, 2026-11-20): one editable Markdown box. Text in {…} is for the AI and sits in `problems`; the rest is for people. */
    staffNote?: StaffNote;
    /** How many staff {…} problems are open — the products list reads only this. */
    noteCount?: number;
    /** Problems that left the open list (owner, 2026-11-20: the history is the closed list) — newest last, last 20. */
    closed?: ClosedProblem[];
};

/** found / fixed: how many open problems the run added / removed (the one-line history). */
// skill "staff" = a stage move made by a person (owner, 2026-11-22); `part` then holds their name.
export type PrepRun = { skill: "product-prep" | "product-recheck" | "staff"; part: string; at: string; from: ShopStatus; to: ShopStatus; found?: number; fixed?: number };

/** The AI's own runs — a staff move is not a run of any part. */
export const aiRuns = (runs: PrepRun[] | undefined) => (runs ?? []).filter((r) => r.skill !== "staff");

/**
 * Keep the shared run list at 10 (owner, 2026-11-22): drop the oldest staff move
 * first; never drop an AI part's latest run (the skills skip a part by it).
 */
export function trimRuns(runs: PrepRun[], max = 10): PrepRun[] {
    const out = [...runs];
    while (out.length > max) {
        let i = out.findIndex((r) => r.skill === "staff");
        if (i < 0) i = out.findIndex((r, k) => out.slice(k + 1).some((n) => n.skill === r.skill && n.part.split(/ \(| · /)[0] === r.part.split(/ \(| · /)[0]));
        out.splice(i < 0 ? 0 : i, 1);
    }
    return out;
}
/** source "staff" = a {…} item from the manual note (part 0, `by` = who wrote it). */
/** by = "AI part 5" / "AI" / a staff name; how = fixed (AI checked) · removed from the note. */
export type ClosedProblem = { text: string; level: "stop" | "fix"; source?: "staff"; raisedBy: string; at: string; by: string; how: "fixed" | "removed" };

/** Append what left the open list, newest last, last 20 kept. */
export function withClosed(info: ShopDraft | null, gone: PrepProblem[], by: string, how: ClosedProblem["how"]): ClosedProblem[] | undefined {
    const now = new Date().toISOString();
    const add = gone.map((p): ClosedProblem => ({ text: p.text, level: p.level, ...(p.source && { source: p.source }), raisedBy: p.source === "staff" ? (p.by ?? "staff") : `AI part ${p.part}`, at: now, by, how }));
    const list = [...(info?.closed ?? []), ...add].slice(-20);
    return list.length ? list : undefined;
}

/** parts = every part that raised it (owner, 2026-11-20: "one problem once, credit both parts"). */
export type PrepProblem = { text: string; level: "stop" | "fix"; part: number; parts?: number[]; at: string; source?: "staff"; by?: string; asideBy?: string; asideAt?: string };

export type RowProblem = { text: string; level: "stop" | "fix" | "note"; aside?: boolean };

export type StaffNote = { text: string; by: string; at: string };

/**
 * A problem as staff read it (owner, 2026-11-20: "only clean problem"): the
 * problem alone, without the "— add it, or tick … under Product image" how-to
 * that older runs wrote after it.
 */
export function problemText(text: string): string {
    return text.replace(/\s+—\s+(add it|take it|run Part \d)[^:]*?(?=:|$)/i, "").replace(/[.\s]+$/, "").trim();
}

/** The {…} items of a manual note — each one is an open problem for the AI. */
export function noteItems(text: string): string[] {
    return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/**
 * An Attention reason split for display (owner, 2026-11-20: "highlight proper way"):
 * the "PENDING / STOPPED / NOTE (Part n) — x" lines are the problems; everything
 * else (what to do after, the Last run line, where it came from) is the small print.
 */
export function splitAttention(text: string | null | undefined): { problems: RowProblem[]; rest: string[] } {
    const problems: RowProblem[] = [];
    const rest: string[] = [];
    for (const line of (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
        const m = /^(PENDING|STOPPED|NOTE) \(Part \d\) — (.*)$/.exec(line);
        if (m) problems.push({ text: problemText(m[2]), level: m[1] === "NOTE" ? "fix" : "stop" });
        else rest.push(line);
    }
    return { problems: [...problems.filter((p) => p.level === "stop"), ...problems.filter((p) => p.level === "fix")], rest };
}

/** A row's problems: the saved list when the product has one, else read from its Attention reason. */
export function rowProblems(info: ShopDraft | null, attention: string | null): RowProblem[] {
    const list = info?.problems ?? [];
    const row = (p: PrepProblem): RowProblem => ({ text: p.source === "staff" && p.by ? `${p.by}: ${p.text}` : problemText(p.text), level: p.source === "staff" ? "note" : p.level, ...(p.asideAt && { aside: true }) });
    const staff = list.filter((p) => p.source === "staff").map(row);
    const ai = list.filter((p) => p.source !== "staff");
    return [...staff, ...(ai.length ? ai.map(row) : splitAttention(attention).problems)];
}

const isRun = (x: unknown): x is PrepRun => !!x && typeof x === "object" && typeof (x as PrepRun).at === "string" && typeof (x as PrepRun).part === "string";
const isNote = (x: unknown): x is StaffNote => !!x && typeof x === "object" && typeof (x as StaffNote).text === "string";
/** The old list of separate staff notes (6a64cca97) read as one note: open ones become {…} items. */
type OldNote = { text: string; by: string; at: string; doneAt?: string };
function fromOldNotes(raw: unknown): StaffNote | undefined {
    const old = Array.isArray(raw) ? raw.filter((x): x is OldNote => isNote(x) && typeof (x as OldNote).by === "string") : [];
    if (!old.length) return undefined;
    return { text: old.map((n) => (n.doneAt ? `- ✓ ${n.text}` : `- {${n.text}}`)).join("\n"), by: old[old.length - 1].by, at: old[old.length - 1].at };
}
const isClosed = (x: unknown): x is ClosedProblem => !!x && typeof x === "object" && typeof (x as ClosedProblem).text === "string" && typeof (x as ClosedProblem).at === "string";
const isProblem = (x: unknown): x is PrepProblem => !!x && typeof x === "object" && typeof (x as PrepProblem).text === "string";

/** Runs, the manual note, staff problems and set-aside problems outlive Ready / Discard — they are the product's history, not the draft's. */
export function prepHistory(info: ShopDraft | null): Pick<ShopDraft, "runs" | "problems" | "asideCount" | "staffNote" | "noteCount" | "closed"> {
    const kept = (info?.problems ?? []).filter((p) => p.asideAt || p.source === "staff");
    const aside = kept.filter((p) => p.asideAt).length;
    const open = kept.filter((p) => p.source === "staff" && !p.asideAt).length;
    return {
        ...(info?.runs?.length && { runs: info.runs }),
        ...(kept.length && { problems: kept }),
        ...(aside && { asideCount: aside }),
        ...(info?.staffNote && { staffNote: info.staffNote }),
        ...(open && { noteCount: open }),
        ...(info?.closed?.length && { closed: info.closed }),
    };
}

export function readShopDraft(raw: unknown): ShopDraft | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as { stageBefore?: unknown; aiCopy?: unknown; notes?: unknown; notesAt?: unknown; kept?: unknown; runs?: unknown; problems?: unknown; staffNote?: unknown; staffNotes?: unknown };
    const runs = Array.isArray(r.runs) ? r.runs.filter(isRun) : [];
    const staffNote = isNote(r.staffNote) ? r.staffNote : fromOldNotes(r.staffNotes);
    let problems = Array.isArray(r.problems) ? r.problems.filter(isProblem) : [];
    // An old-style note's open items join the shared list once, as staff problems.
    if (!isNote(r.staffNote) && staffNote) {
        const have = new Set(problems.map((p) => p.text.toLowerCase()));
        problems = [...noteItems(staffNote.text).filter((t) => !have.has(t.toLowerCase())).map((text) => ({ text, level: "fix" as const, part: 0, at: staffNote.at, source: "staff" as const, by: staffNote.by })), ...problems];
    }
    const aside = problems.filter((p) => p.asideAt).length;
    const openStaff = problems.filter((p) => p.source === "staff" && !p.asideAt).length;
    const closed = Array.isArray((raw as { closed?: unknown }).closed) ? ((raw as { closed: unknown[] }).closed).filter(isClosed).slice(-20) : [];
    const notes = Array.isArray(r.notes) ? r.notes.filter((x): x is string => typeof x === "string") : [];
    const stages: unknown[] = ["UNPUBLISHED", "READY", "PUBLISHED"]; // never a work stage (Draft / Attention / Waiting)
    return {
        ...(stages.includes(r.stageBefore) ? { stageBefore: r.stageBefore as ShopStatus } : {}),
        ...(r.aiCopy && typeof r.aiCopy === "object" ? { aiCopy: r.aiCopy as ProductCopy } : {}),
        ...(notes.length ? { notes } : {}),
        ...(notes.length && typeof r.notesAt === "string" ? { notesAt: r.notesAt } : {}),
        ...(notes.length && r.kept === true ? { kept: true } : {}),
        ...(runs.length ? { runs } : {}),
        ...(problems.length ? { problems } : {}),
        ...(aside ? { asideCount: aside } : {}),
        ...(staffNote ? { staffNote } : {}),
        ...(openStaff ? { noteCount: openStaff } : {}),
        ...(closed.length ? { closed } : {}),
    };
}

/**
 * The AI's notes worth keeping when a product leaves Draft / Attention by Save
 * as ready or a stage button: the review notes, the Attention reason and the
 * AI copy's own notes and data flags. Null when there are none.
 */
export function keptReviewNotes(info: ShopDraft | null, attention: string | null, at: Date | null): ShopDraft | null {
    const notes = [...new Set([
        ...(info?.notes ?? []),
        ...(attention ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
        ...(info?.aiCopy?.notes ?? []),
        ...(info?.aiCopy?.flags ?? []),
    ])].slice(0, 40);
    const history = prepHistory(info);
    if (!notes.length) return Object.keys(history).length ? history : null;
    return { notes, notesAt: info?.notesAt ?? at?.toISOString(), kept: true, ...history };
}
import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { readPhotoChecklist, type PhotoChecklist } from "@/modules/ecommerce/lib/photoChecklist";

/** Admin shape — storefront fields + inventory + stock management. */
export type ShopProductAdmin = ShopProductPublic & {
    sku: string;
    stock: number | null;
    lowStockThreshold: number;
    isActive: boolean;
    /** Live in the shop right now (PUBLISHED and the publish rules met). */
    isListedInShop: boolean;
    /** Stage: UNPUBLISHED → READY → PUBLISHED ("Pending" = PUBLISHED, not live). */
    shopStatus: ShopStatus;
    /** When it was last saved as draft or Claude wrote on it (null = not in Draft). */
    shopDraftAt: string | null;
    /** Needs attention: the problem staff or Claude found (null = none). Beside any stage. */
    shopAttention: string | null;
    shopAttentionAt: string | null;
    shopAttentionBy: string | null;
    /** Stage-before + Claude's notes — only the product's own page gets it (withShopDraft). */
    shopDraft?: ShopDraft | null;
    /** An open staff note — the list's "Staff notes" filter. List rows only. */
    hasStaffNotes?: boolean;
    /** A problem staff set aside ("can't fix now") — the list's "Set aside" tab. List rows only. */
    hasAsideProblems?: boolean;
    /** The open and set-aside problems, red first — shown in the list's Shop status (owner, 2026-11-20). List rows only. */
    problems?: RowProblem[];
    /** Per-product override: accept orders even at zero stock (backorder). */
    allowBackorder: boolean;
    unitId: number;
    categoryId: number | null;
    /** Every collection id, main first (InvProductCollection). */
    collectionIds: number[];
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    /** Shipping weight of one unit in grams (null = unset → quote uses fallback). */
    weightGrams: number | null;
    /** Parcel dimensions of one unit (cm) — drive volumetric weight. */
    lengthCm: number | null;
    breadthCm: number | null;
    heightCm: number | null;
    /** Resolved brand / product-group display names (null when unset). */
    brandName: string | null;
    groupName: string | null;
    /** Raw explicit storefront category (null when unset) — for the publish gate. */
    shopCategory: string | null;
    // Display-only: the human saved sale price and the derived barcode tag price
    // (what the storefront actually charges). The editable `pricePaise` above
    // stays the effective/strategy price so the form round-trips it unchanged.
    savedSalePricePaise: number | null;
    barcodePricePaise: number | null;
    /** Every scannable code on the product (barcode + EAN + UPC) — search only. */
    codes: { kind: string; value: string }[];
    /** Photo checklist under Product image (null = never checked). */
    photoChecklist: PhotoChecklist | null;
    /** Attributes a sibling variant has filled and this one has not ("Colour").
     *  Filled in by the admin routes (loadVariantAttrGaps); absent = none. */
    variantAttrGaps?: string[];
};

export function invProductToAdmin(
    p: Omit<InvProduct, "shopDraftJson"> & {
        category?: { name: string } | null;
        brand?: { name: string } | null;
        group?: { name: string } | null;
        codes?: { kind: string; value: string }[];
        collections?: { categoryId: number; category: { name: string } }[];
    },
    bands?: BarcodeBand[]
): ShopProductAdmin {
    // No bands → editable `pricePaise` keeps the effective price (round-trip safe).
    const pub = invProductToPublic(p);
    return {
        ...pub,
        // "Category" here IS the office product group, renamed for the shop on
        // purpose: the office follows Tally (stock groups; GST set group-wise), the
        // shop uses the e-commerce word customers know. See docs/vocabulary.md.
        // Mirror the storefront rule (shopCategory ?? group, else blank) so the
        // admin Category column reads the same as the live shop. The admin row has
        // only the product's DIRECT group, not the root — close enough here, and the
        // separate Group filter already exposes the real group. Storefront truth
        // lives in invProductToPublic + loadShopGroupRoots.
        category: p.shopCategory ?? p.group?.name ?? "",
        sku: p.sku,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        isActive: p.isActive,
        isListedInShop: p.isListedInShop,
        shopStatus: p.shopStatus,
        shopDraftAt: p.shopDraftAt?.toISOString() ?? null,
        shopAttention: p.shopAttention ?? null,
        shopAttentionAt: p.shopAttentionAt?.toISOString() ?? null,
        shopAttentionBy: p.shopAttentionBy ?? null,
        allowBackorder: p.allowBackorder,
        unitId: p.unitId,
        categoryId: p.categoryId,
        collectionIds: p.collections?.length
            ? p.collections.map((c) => c.categoryId)
            : p.categoryId != null ? [p.categoryId] : [],
        groupId: p.groupId,
        brandId: p.brandId,
        warrantyTermId: p.warrantyTermId,
        weightGrams: p.weightGrams ?? null,
        lengthCm: p.lengthCm ?? null,
        breadthCm: p.breadthCm ?? null,
        heightCm: p.heightCm ?? null,
        brandName: p.brand?.name ?? null,
        groupName: p.group?.name ?? null,
        shopCategory: p.shopCategory,
        savedSalePricePaise: p.savedSalePricePaise,
        barcodePricePaise: bands ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands, p.barcodeManualPaise) : null,
        codes: p.codes ?? [],
        photoChecklist: readPhotoChecklist(p.photoChecklistJson),
    };
}

/** The admin row plus its draft copy — for the product's own page only (lists skip the JSON). */
export function withShopDraft(
    p: InvProduct & Parameters<typeof invProductToAdmin>[0],
    bands?: BarcodeBand[],
): ShopProductAdmin {
    return { ...invProductToAdmin(p, bands), shopDraft: readShopDraft(p.shopDraftJson) };
}

