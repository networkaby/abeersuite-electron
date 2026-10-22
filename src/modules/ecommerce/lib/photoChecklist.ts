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
export type PhotoChecklistItem = { kind: PhotoKind; done: boolean; must: boolean };
/** `enough` = every must row is done (worked out, not the AI's word). */
export type PhotoChecklist = { items: PhotoChecklistItem[]; enough: boolean; at: string };

/** A web photo from a page Verified kept, with the kind the AI says it shows. */
export type PhotoSuggestion = { url: string; site: string; kind: PhotoKind | null };

export const isEnough = (items: PhotoChecklistItem[]) => items.every((i) => i.done || !i.must);

/** AI answer → checklist: what we have is done, what we miss is open (must first); nothing else is listed. */
export function checklistFrom(have: PhotoKind[], must: PhotoKind[], nice: PhotoKind[]): PhotoChecklist {
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
    return { items, enough: isEnough(items), at: new Date().toISOString() };
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
        return [{ kind, done: o.done === true, must: typeof o.must === "boolean" ? o.must : r.enough !== true }];
    });
    return { items, enough: isEnough(items), at: typeof r.at === "string" ? r.at : "" };
}
