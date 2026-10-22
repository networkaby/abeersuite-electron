// Photo checklist under Product image (owner, 2026-10-22): the Verified AI says
// which kinds of photo the gallery has and which a buyer (and search) would
// miss; staff tick them off. Saved on InvProduct.photoChecklistJson. Pure — the
// form, the PATCH schema and the AI step share it.

export const PHOTO_KINDS = {
    front: "Product front",
    back: "Product back / other side",
    side: "Another angle",
    box_front: "Box front",
    box_back: "Box back / other side",
    label: "Label / spec sheet",
    in_use: "Product in use",
    size: "Size / scale",
    in_box: "What's in the box",
    promo: "Promo / feature banner",
} as const;

export type PhotoKind = keyof typeof PHOTO_KINDS;
export const PHOTO_KIND_KEYS = Object.keys(PHOTO_KINDS) as PhotoKind[];
export const isPhotoKind = (v: unknown): v is PhotoKind => typeof v === "string" && v in PHOTO_KINDS;

/** One row under Product image. `done` = the gallery has this kind (AI saw it, or staff ticked it). */
export type PhotoChecklistItem = { kind: PhotoKind; done: boolean };
export type PhotoChecklist = { items: PhotoChecklistItem[]; enough: boolean; at: string };

/** A web photo from a page Verified kept, with the kind the AI says it shows. */
export type PhotoSuggestion = { url: string; site: string; kind: PhotoKind | null };

/** AI answer → checklist: what we have is done, what we miss is open; nothing else is listed. */
export function checklistFrom(have: PhotoKind[], missing: PhotoKind[], enough: boolean): PhotoChecklist {
    const items = [
        ...have.map((kind) => ({ kind, done: true })),
        ...missing.filter((k) => !have.includes(k)).map((kind) => ({ kind, done: false })),
    ];
    return { items, enough, at: new Date().toISOString() };
}

/** A saved InvProduct.photoChecklistJson, or null when unset or unreadable. */
export function readPhotoChecklist(raw: unknown): PhotoChecklist | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.items)) return null;
    const items = r.items
        .filter((x): x is { kind: PhotoKind; done: unknown } => !!x && typeof x === "object" && isPhotoKind((x as { kind?: unknown }).kind))
        .map((x) => ({ kind: x.kind, done: x.done === true }));
    return { items, enough: r.enough === true, at: typeof r.at === "string" ? r.at : "" };
}
