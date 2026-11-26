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
    /** 2 = `problems` holds every open problem (owner, 2026-11-25). Absent = old row, read through `draftOf`. */
    v?: 2;
    /** Part 5's web photos for a product with no AI copy — staff's Add buttons. */
    photoOffers?: PhotoSuggestion[];
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
export type PrepRun = { skill: "product-prep" | "product-recheck" | "staff"; part: string; at: string; from: ShopStatus; to: ShopStatus; found?: number; fixed?: number; removed?: { url: string; why: string }[];
    /** The part Part 4 says repairs it. */
    next?: string };

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
export type ClosedProblem = { text: string; level: PrepProblem["level"]; source?: "staff"; raisedBy: string; at: string; by: string; how: "fixed" | "removed" };

/** Append what left the open list, newest last, last 20 kept. */
export function withClosed(info: ShopDraft | null, gone: PrepProblem[], by: string, how: ClosedProblem["how"]): ClosedProblem[] | undefined {
    const now = new Date().toISOString();
    const add = gone.map((p): ClosedProblem => ({ text: p.text, level: p.level, ...(p.source && { source: p.source }), raisedBy: p.source === "staff" ? (p.by ?? "staff") : p.part ? `AI part ${p.part}` : (p.by ?? "AI"), at: now, by, how }));
    const list = [...(info?.closed ?? []), ...add].slice(-20);
    return list.length ? list : undefined;
}

/** parts = every part that raised it (owner, 2026-11-20: "one problem once, credit both parts"). */
/**
 * Problem levels, most serious first (owner, 2026-11-27): stop (red) and fix (yellow)
 * block and park in Attention; tip (cyan) is "better to do" — never blocks, never
 * moves the stage, never closed by a part's own re-run, only by /fixed or its writer.
 */
export type PrepProblem = { text: string; level: "stop" | "fix" | "tip"; part: number; parts?: number[]; at: string; source?: "staff"; by?: string; asideBy?: string; asideAt?: string };

export type RowProblem = { text: string; level: "stop" | "fix" | "tip" | "note"; aside?: boolean };

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

export const OPEN_LINE = /^(PENDING|STOPPED|NOTE) \(Part (\d)\) — /;
/** "PENDING (Part 4) — x" → "x". */
export const openText = (l: string) => l.trim().replace(OPEN_LINE, "").trim();
const MAIN_NOT_CLEAN = "main photo is not a clean product photo";
/**
 * One problem, however a part worded its tag or spacing — passes and repeats match on this.
 * The main-photo line carries the AI's reason in brackets, worded afresh each run, so it
 * matches on its fixed part: a temporary pass on it holds until a clean main photo is added.
 */
export const problemKey = (l: string) => {
    const k = openText(l).toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
    return k.startsWith(MAIN_NOT_CLEAN) ? MAIN_NOT_CLEAN : k;
};

/** What a writer hands over: the problem, how strong, and who found it. */
export type RaisedProblem = { text: string; level: PrepProblem["level"]; part: number; by?: string };
/** A part's line ("PENDING (Part 4) — x", or plain text) as a problem. */
export function raisedLine(line: string, part: number, level: PrepProblem["level"] = "stop", by?: string): RaisedProblem {
    const m = OPEN_LINE.exec(line.trim());
    return { text: openText(line).replace(/\s+/g, " "), level: m ? (m[1] === "NOTE" ? "fix" : "stop") : level, part: m ? Number(m[2]) : part, ...(by && { by }) };
}

/** Does this problem hold the product back? A temporary pass or a tip never does. */
export const blocks = (p: PrepProblem) => !p.asideAt && p.level !== "tip";

/** Put a problem list on a draft: red first, then yellow, staff's, tips, passed ones — and the counts the list reads. */
export function withProblems(info: ShopDraft | null, list: PrepProblem[]): ShopDraft {
    const ai = list.filter((p) => !p.source && blocks(p));
    const tips = list.filter((p) => !p.source && !p.asideAt && p.level === "tip");
    const staff = list.filter((p) => p.source === "staff" && !p.asideAt);
    const aside = list.filter((p) => p.asideAt);
    const problems = [...ai.filter((p) => p.level === "stop"), ...ai.filter((p) => p.level === "fix"), ...staff, ...tips, ...aside];
    return { ...info, v: 2, problems: problems.length ? problems : undefined, asideCount: aside.length || undefined, noteCount: staff.length || undefined };
}

/**
 * The one way an AI problem gets on the list (owner, 2026-11-25). One already there —
 * open, staff's or with a temporary pass — is never added twice; another part
 * raising it is credited. "replaces" picks the open AI problems this run speaks
 * for: one it no longer raises goes to the history.
 */
export function raiseProblems(info: ShopDraft | null, items: RaisedProblem[], opts: { replaces?: (p: PrepProblem) => boolean; by: string; tips?: boolean }): ShopDraft {
    const now = new Date().toISOString();
    const raised = new Set(items.map((i) => problemKey(i.text)));
    const before = info?.problems ?? [];
    // A tip is closed only by /fixed or by a writer that names tips in "replaces".
    const gone = before.filter((p) => !p.asideAt && !p.source && (p.level !== "tip" || opts.tips) && opts.replaces?.(p) && !raised.has(problemKey(p.text)));
    const list = before.filter((p) => !gone.includes(p)).map((p) => ({ ...p }));
    for (const i of items) {
        if (!i.text.trim()) continue;
        const was = list.find((p) => problemKey(p.text) === problemKey(i.text));
        if (!was) { list.push({ ...i, at: now }); continue; }
        if (was.asideAt || was.source) continue;
        const parts = [...new Set([...(was.parts ?? [was.part]), i.part])].filter(Boolean).sort();
        if (parts.length > 1) was.parts = parts;
        // A part finding a tip serious makes it serious; a tip never weakens a real problem.
        if (i.level === "stop" || (i.level === "fix" && was.level === "tip")) was.level = i.level;
        was.text = i.text;
    }
    return { ...withProblems(info, list), closed: gone.length ? withClosed(info, gone, opts.by, "fixed") : info?.closed };
}

/** The Attention reason: a summary made from the list — never read back as problems. "more" = the small print. */
export function attentionText(info: ShopDraft | null, more: string[]): string {
    const open = (info?.problems ?? []).filter((p) => blocks(p) && !p.source);
    return [...open.map((p) => `${p.level === "stop" ? "PENDING" : "NOTE"} (Part ${p.part}) — ${p.text}`), ...more].filter(Boolean).join("\n").slice(0, 10000);
}
/** The small print of a saved Attention reason (what to do after, the Last run line, where it came from). */
export const attentionInfo = (text: string | null | undefined) =>
    (text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !OPEN_LINE.test(l));

/** The reason again after the list changed: same small print, problems as they are now. */
export function attentionAgain(old: string | null, before: ShopDraft | null, now: ShopDraft): string | null {
    if (!old) return old;
    const were = new Set((before?.problems ?? []).map((p) => problemKey(p.text)));
    return attentionText(now, attentionInfo(old).filter((l) => !were.has(problemKey(l)))) || null;
}

export type DraftRow = { shopDraftJson: unknown; shopStatus: ShopStatus; shopAttention: string | null; shopAttentionAt?: Date | null };
/**
 * The draft of a product row. An old row (no "v") also kept problems as text in its
 * Attention reason and as flags on the AI copy: they join the list here, so every
 * reader and writer sees one list. Goes once scripts/migrate-ai-notes.ts has run.
 */
export function draftOf(row: DraftRow): ShopDraft | null {
    const info = readShopDraft(row.shopDraftJson);
    if (info?.v === 2) return info;
    const parked = row.shopStatus === "ATTENTION" ? (row.shopAttention ?? "").split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const tagged = parked.filter((l) => OPEN_LINE.test(l));
    const plain = tagged.length ? [] : parked.filter((l) => !/^(Last run: |Was (Published|Ready|Unpublished)|Fix it, then |Run Part )/.test(l));
    const done = new Set((info?.closed ?? []).map((c) => problemKey(c.text)));
    const flags = (info?.aiCopy?.flags ?? []).filter((f) => !done.has(problemKey(f)));
    const items = [...tagged.map((l) => raisedLine(l, 0)), ...plain.map((l) => raisedLine(l, 0, "fix")), ...flags.map((l) => raisedLine(l, 0, "fix"))];
    if (!info && !items.length) return null;
    const had = new Set((info?.problems ?? []).map((p) => problemKey(p.text)));
    const out = raiseProblems(info, items, { by: "" });
    const at = row.shopAttentionAt?.toISOString();
    return {
        ...out,
        ...(at && out.problems && { problems: out.problems.map((p) => (had.has(problemKey(p.text)) ? p : { ...p, at })) }),
        ...(out.aiCopy && { aiCopy: photoCopy(out.aiCopy) }),
    };
}
/** The AI copy as it is kept: its text and photo advice. Problems live on the list; old-style notes are gone. */
export const photoCopy = (c: ProductCopy): ProductCopy => ({ ...c, flags: [], notes: [], note: "", unsure: [], sources: [], specSources: undefined });

/** The problems as the products list shows them. */
export function rowProblems(info: ShopDraft | null): RowProblem[] {
    const row = (p: PrepProblem): RowProblem => ({ text: p.source === "staff" && p.by ? `${p.by}: ${p.text}` : problemText(p.text), level: p.source === "staff" ? "note" : p.level, ...(p.asideAt && { aside: true }) });
    const list = info?.problems ?? [];
    return [...list.filter((p) => p.source === "staff").map(row), ...list.filter((p) => p.source !== "staff").map(row)];
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

/**
 * What outlives Ready / Discard: the runs, the manual note, staff's problems, passed
 * ones, tips and the history. An AI problem still open goes to the history, closed by `by`.
 */
export function prepHistory(info: ShopDraft | null, by: string): ShopDraft | null {
    // Tips stay too: still worth doing after Ready.
    const gone = (info?.problems ?? []).filter((p) => blocks(p) && p.source !== "staff");
    const kept = (info?.problems ?? []).filter((p) => !blocks(p) || p.source === "staff");
    const closed = gone.length ? withClosed(info, gone, by, "fixed") : info?.closed;
    if (!info?.runs?.length && !kept.length && !info?.staffNote && !closed?.length) return null;
    return withProblems({
        ...(info?.runs?.length && { runs: info.runs }),
        ...(info?.staffNote && { staffNote: info.staffNote }),
        ...(closed?.length && { closed }),
    }, kept);
}

export function readShopDraft(raw: unknown): ShopDraft | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as { stageBefore?: unknown; v?: unknown; aiCopy?: unknown; runs?: unknown; problems?: unknown; staffNote?: unknown; staffNotes?: unknown; photoOffers?: unknown };
    const offers = Array.isArray(r.photoOffers) ? r.photoOffers.filter((x): x is PhotoSuggestion => !!x && typeof x === "object" && typeof (x as PhotoSuggestion).url === "string") : [];
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
    const stages: unknown[] = ["UNPUBLISHED", "READY", "PUBLISHED"]; // never a work stage (Draft / Attention / Waiting)
    return {
        ...(stages.includes(r.stageBefore) ? { stageBefore: r.stageBefore as ShopStatus } : {}),
        ...(r.aiCopy && typeof r.aiCopy === "object" ? { aiCopy: r.aiCopy as ProductCopy } : {}),
        ...(r.v === 2 ? { v: 2 as const } : {}),
        ...(offers.length ? { photoOffers: offers } : {}),
        ...(runs.length ? { runs } : {}),
        ...(problems.length ? { problems } : {}),
        ...(aside ? { asideCount: aside } : {}),
        ...(staffNote ? { staffNote } : {}),
        ...(openStaff ? { noteCount: openStaff } : {}),
        ...(closed.length ? { closed } : {}),
    };
}

import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { readPhotoChecklist, type PhotoChecklist, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

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
    return { ...invProductToAdmin(p, bands), shopDraft: draftOf(p) };
}


/**
 * The next step for a product (owner, 2026-11-22) — the last line of AI notes and
 * `prep.next` in the agent API. Worked out each time from the stage, the content and
 * the run list; nothing is saved. Staff may press it (`act`); an AI told to "follow
 * next" runs exactly `skill` / `part`. Attention resumes from whoever parked it:
 * part 1 / 2 → Start again; part 3 / 4 / 5 → Save as draft; staff from Published /
 * Ready → Save as ready; staff from anywhere else → Save as draft.
 */
export type NextAct = "start" | "save" | "ready" | "publish";
export type NextStep = { text: string; act?: NextAct; actLabel?: string; skill?: "product-prep" | "product-recheck"; part?: string };
export type NextInput = {
    stage: ShopStatus;
    /** Published and in the shop (false = Pending). */
    listed: boolean;
    photos: number;
    weight: boolean;
    description: boolean;
    runs: PrepRun[];
    openProblems: number;
    /** The Attention reason — its Last run line says which part parked it, and what Part 4 wants next. */
    attention?: string | null;
    /** What the publish rules still need (Pending only). */
    pendingMissing?: string[];
};

const partNo = (r: PrepRun) => Number(r.part.split(/ \(| · |\+/)[0]) || 0;

export function nextStep(i: NextInput): NextStep {
    const fix = i.openProblems ? `fix ${i.openProblems} open problem${i.openProblems > 1 ? "s" : ""}, then ` : "";
    const ai = aiRuns(i.runs);
    switch (i.stage) {
        case "UNPUBLISHED":
            if (!i.photos || !i.weight) return { text: `add ${[!i.photos && "photos", !i.weight && "shipping weight"].filter(Boolean).join(" and ")}, then Start` };
            return { text: "Start → product-prep part 1", act: "start", actLabel: "Start" };
        case "WAITING": {
            const last = [...ai].reverse().find((r) => r.skill === "product-prep");
            const done = last && last.to === "WAITING" ? partNo(last) : 0;
            const part = i.description ? (done >= 1 ? "5" : "1") : String(Math.min(done + 1, 3));
            return { text: `product-prep part ${part}${i.description && part === "1" ? " + 5 (photos only)" : ""}`, skill: "product-prep", part };
        }
        case "DRAFT":
            return { text: `${fix}product-recheck part 4 → Ready`, skill: "product-recheck", part: "4" };
        case "ATTENTION": {
            const parked = [...i.runs].reverse().find((r) => r.to === "ATTENTION");
            if (parked?.skill === "staff" && !/^Last run: /m.test(i.attention ?? "")) {
                return parked.from === "PUBLISHED" || parked.from === "READY"
                    ? { text: `${fix}Save as ready → Publish`, act: "ready", actLabel: "Save as ready" }
                    : { text: `${fix}Save as draft → product-recheck part 4`, act: "save", actLabel: "Save as draft" };
            }
            // The reason is the stop itself; the run list may miss it (an old stop, a trimmed list).
            const said = /^Last run: Part (\d)\b(?:.*· next: Part (\d))?/m.exec(i.attention ?? "");
            const then = parked?.next ?? said?.[2];
            // Part 4 says which part repairs it (owner, 2026-11-25): photos → 5, text → 3, start again → 1.
            if (then) {
                const what = then === "5" ? "part 5 (photos, with part 1)" : then === "3" ? "part 3 (rewrite)" : `part ${then}`;
                return { text: `${fix ? "fix by hand, or " : ""}Start → product-prep ${what}`, act: "start", actLabel: "Start", skill: "product-prep", part: then };
            }
            const p = said ? Number(said[1]) : parked ? partNo(parked) : Number(/\(Part ([1-5])\) —/.exec(i.attention ?? "")?.[1] ?? 1);
            return p <= 2
                ? { text: `${fix}Start → product-prep part ${p || 1} runs again`, act: "start", actLabel: "Start", skill: "product-prep", part: String(p || 1) }
                : { text: `${fix}Save as draft → product-recheck part 4`, act: "save", actLabel: "Save as draft" };
        }
        case "READY":
            return { text: "Publish", act: "publish", actLabel: "Publish" };
        case "PUBLISHED":
            return i.listed
                ? { text: "nothing — live on the shop" }
                : { text: `add ${i.pendingMissing?.length ? i.pendingMissing.join(", ").toLowerCase() : "what the publish rules need"} — it goes live by itself` };
        default:
            return { text: "" };
    }
}
