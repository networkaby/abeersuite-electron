// Photo checklist under Product image (owner, 2026-10-22): the Verified AI says
// which kinds of photo the gallery has and which a buyer (and search) would
// miss; staff tick them off. Saved on InvProduct.photoChecklistJson. Pure — the
// form, the PATCH schema and the AI step share it.
//
// Owner's menu: a box and a product each have six sides, but only the sides
// that show something count (no blank or repeated side); plus "feel" photos —
// size, real-life use, cinematic — that let the buyer feel the product and buy
// on impulse. Size is one kind: any photo that lets the buyer gauge size.

export const PHOTO_GROUPS = { product: "Product", box: "Box", feel: "Feel & experience" } as const;
export type PhotoGroup = keyof typeof PHOTO_GROUPS;

export const PHOTO_KINDS = {
    front: { label: "Front", group: "product" },
    back: { label: "Back", group: "product" },
    left: { label: "Left side", group: "product" },
    right: { label: "Right side", group: "product" },
    top: { label: "Top", group: "product" },
    bottom: { label: "Bottom", group: "product" },
    ports: { label: "Ports / buttons close-up", group: "product" },
    detail: { label: "Detail / texture close-up", group: "product" },
    box_front: { label: "Box front", group: "box" },
    box_back: { label: "Box back", group: "box" },
    box_left: { label: "Box left side", group: "box" },
    box_right: { label: "Box right side", group: "box" },
    box_top: { label: "Box top", group: "box" },
    box_bottom: { label: "Box bottom", group: "box" },
    in_box: { label: "What's in the box (all items laid out)", group: "box" },
    size: { label: "Size — in hand, beside a ruler or a common object", group: "feel" },
    in_use: { label: "Real-life use (desk, home, office)", group: "feel" },
    working: { label: "Connected / working (lights or screen on)", group: "feel" },
    cinematic: { label: "Cinematic / beauty shot", group: "feel" },
    compare: { label: "Compared with similar models or sizes", group: "feel" },
    promo: { label: "Feature banner / promo", group: "feel" },
} as const satisfies Record<string, { label: string; group: PhotoGroup }>;

export type PhotoKind = keyof typeof PHOTO_KINDS;
export const PHOTO_KIND_KEYS = Object.keys(PHOTO_KINDS) as PhotoKind[];
export const isPhotoKind = (v: unknown): v is PhotoKind => typeof v === "string" && v in PHOTO_KINDS;
export const photoKindLabel = (k: PhotoKind) => PHOTO_KINDS[k].label;

/** Kinds from the first menu (361dedba) that were renamed; the rest kept their key. */
const OLD_KINDS: Record<string, PhotoKind> = { side: "left", label: "box_back" };

/**
 * One row under Product image. `done` = the gallery has this kind (AI saw it, or
 * staff ticked it). `must` = needed to judge the product; the rest add feel.
 */
export type PhotoChecklistItem = {
    kind: PhotoKind; done: boolean; must: boolean;
    /** Staff ticked "Not applicable" on a must photo (owner, 2026-11-18): it stops blocking, and the search looks for it online instead. */
    waived?: boolean;
};

/**
 * How the product is packed (owner, 2026-11-18) — it says which box photos are
 * a must. The AI reads it from the photos; the rest of the list is the AI's own,
 * per product, from how the maker and good sellers show it.
 */
export const BOX_TYPES = { loose: "No box (loose)", card: "Blister / card pack", pouch: "Pouch / bag", carton: "Box / carton" } as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_KEYS = Object.keys(BOX_TYPES) as BoxType[];
const isBoxType = (v: unknown): v is BoxType => typeof v === "string" && v in BOX_TYPES;

/** The fixed floor under the AI's list: a clean product photo without the box, always; a boxed product also needs the box front and back. */
export const photoFloor = (box: BoxType | undefined): PhotoKind[] => ["front", ...(box && box !== "loose" ? (["box_front", "box_back"] as const) : [])];
export const PHOTO_REMOVE_REASONS = { duplicate: "Almost the same as another photo", irrelevant: "Not this product", quality: "Poor quality" } as const;
export type PhotoRemoveReason = keyof typeof PHOTO_REMOVE_REASONS;
/** A gallery photo the AI says to remove — by URL, so reordering keeps it right. Staff decide. */
export type PhotoRemoval = { url: string; why: PhotoRemoveReason; note: string };

/** `enough` = every must row is done (worked out, not the AI's word). */
export type PhotoChecklist = {
    items: PhotoChecklistItem[]; enough: boolean; at: string; remove: PhotoRemoval[];
    /** Set by product prep: the packing, and the AI's word on the product's shape / size. */
    box?: BoxType;
    shape?: string;
    /** Product prep's last word on photo 1: the product itself, no box, no logo or text. */
    mainClean?: boolean;
    /**
     * Staff ticked "Can't do" on the clean main photo (owner, 2026-11-19): e.g. every
     * box in stock already carries our barcode / price label, so no clean one can be
     * taken. It stops blocking; cleared once the main photo is clean.
     */
    mainWaived?: boolean;
};

/**
 * Photo AI's arrangement of our gallery — staff apply it or not, nothing is
 * saved here. `order`: our photo URLs, best first (removals left out). `looks`:
 * a photo's URL with a new framing / fix baked in (cloudinaryImage withAdjust).
 */
export type PhotoArrange = { order: string[]; looks: { url: string; next: string; why: string }[] };

/** A web photo from a page Verified kept, with the kind the AI says it shows. */
export type PhotoSuggestion = { url: string; site: string; kind: PhotoKind | null };

export const isEnough = (items: PhotoChecklistItem[]) => items.every((i) => i.done || !i.must || i.waived);
/** Must photos neither in the gallery nor ticked "Not applicable". */
export const missingMust = (c: PhotoChecklist | null) => c?.items.filter((i) => i.must && !i.done && !i.waived).map((i) => i.kind) ?? [];

/** AI answer → checklist: what we have is done, what we miss is open (must first); nothing else is listed. */
export function checklistFrom(have: PhotoKind[], must: PhotoKind[], nice: PhotoKind[], remove: PhotoRemoval[] = []): PhotoChecklist {
    const seen = new Set<PhotoKind>();
    const items: PhotoChecklistItem[] = [];
    const add = (kind: PhotoKind, done: boolean, isMust: boolean) => {
        if (seen.has(kind)) return;
        seen.add(kind);
        items.push({ kind, done, must: isMust });
    };
    have.forEach((k) => add(k, true, must.includes(k)));
    must.forEach((k) => add(k, false, true));
    nice.forEach((k) => add(k, false, false));
    return { items, enough: isEnough(items), at: new Date().toISOString(), remove };
}

/** A saved InvProduct.photoChecklistJson, or null when unset or unreadable. */
export function readPhotoChecklist(raw: unknown): PhotoChecklist | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.items)) return null;
    const seen = new Set<PhotoKind>();
    const items = r.items.flatMap((x): PhotoChecklistItem[] => {
        if (!x || typeof x !== "object") return [];
        const o = x as Record<string, unknown>;
        const kind = isPhotoKind(o.kind) ? o.kind : OLD_KINDS[String(o.kind)];
        if (!kind || seen.has(kind)) return [];
        seen.add(kind);
        // A first-menu row has no `must`; its gallery verdict stands in.
        return [{ kind, done: o.done === true, must: typeof o.must === "boolean" ? o.must : r.enough !== true, ...(o.waived === true && { waived: true }) }];
    });
    const remove = (Array.isArray(r.remove) ? r.remove : []).flatMap((x): PhotoRemoval[] => {
        const o = (x ?? {}) as Record<string, unknown>;
        return typeof o.url === "string" && typeof o.why === "string" && o.why in PHOTO_REMOVE_REASONS
            ? [{ url: o.url, why: o.why as PhotoRemoveReason, note: typeof o.note === "string" ? o.note : "" }]
            : [];
    });
    return {
        items, enough: isEnough(items), at: typeof r.at === "string" ? r.at : "", remove,
        ...(isBoxType(r.box) && { box: r.box }),
        ...(typeof r.shape === "string" && r.shape && { shape: r.shape }),
        ...(typeof r.mainClean === "boolean" && { mainClean: r.mainClean }),
        ...(r.mainWaived === true && { mainWaived: true }),
    };
}
