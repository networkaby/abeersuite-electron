"use client";

import { useEffect, useRef, useState, useEffectEvent } from "react";
import { toast } from "sonner";
import { Check, ImagePlus, ZoomIn } from "lucide-react";
import { ImageViewer } from "@/shared/components/ImageViewer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { IMAGE_FIXES, PAD_BACKGROUNDS, cloudinaryThumb, readAdjust, withoutAdjust } from "@/shared/lib/cloudinaryImage";
import { BOX_TYPES, PHOTO_GROUPS, PHOTO_KINDS, PHOTO_REMOVE_REASONS, photoKindLabel, type PhotoArrange, type PhotoChecklist, type PhotoGroup, type PhotoKind, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

// Verified's photo suggestions (owner, 2026-10-22): shown while the draft is
// open, never added on their own. A gallery the AI calls enough keeps them
// folded. Added photos are copied into our own Cloudinary folder — never the
// other site's link, which breaks.

export function AiPhotoPicker({
    suggestions,
    checklist,
    onAdd,
}: {
    suggestions: PhotoSuggestion[];
    checklist: PhotoChecklist | null;
    /** Our copies of the picked photos, with the kinds they fill. */
    onAdd: (urls: string[], kinds: PhotoKind[]) => void;
}) {
    const missing = new Set(checklist?.items.filter((i) => !i.done).map((i) => i.kind) ?? []);
    // Already added this session: hidden, so a photo cannot go in twice.
    const [added, setAdded] = useState<Set<string>>(new Set());
    // Photos that fill a gap first.
    const ordered = suggestions.filter((s) => !added.has(s.url)).sort((a, b) => Number(!!b.kind && missing.has(b.kind)) - Number(!!a.kind && missing.has(a.kind)));
    const [open, setOpen] = useState(!checklist?.enough);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    // Index into `ordered` shown full screen — to judge a photo before ticking it.
    const [viewing, setViewing] = useState<number | null>(null);

    if (!ordered.length) return null;

    const toggle = (url: string) => setPicked((s) => {
        const n = new Set(s);
        if (n.has(url)) n.delete(url); else n.add(url);
        return n;
    });

    const add = async () => {
        setBusy(true);
        const chosen = ordered.filter((s) => picked.has(s.url));
        const done = await Promise.all(chosen.map(async (s) => {
            try {
                return { from: s.url, url: await uploadImageToCloudinary(s.url, "/api/upload-signature", "shop/products"), kind: s.kind };
            } catch {
                return null;
            }
        }));
        const ok = done.filter((d): d is { from: string; url: string; kind: PhotoKind | null } => d !== null);
        setAdded((a) => new Set([...a, ...ok.map((d) => d.from)]));
        if (ok.length) onAdd(ok.map((d) => d.url), ok.flatMap((d) => (d.kind ? [d.kind] : [])));
        if (ok.length < chosen.length) toast.error(`${chosen.length - ok.length} photo(s) could not be copied — the site may block downloads`);
        else toast.success(`${ok.length} photo(s) added to the gallery`);
        setPicked(new Set());
        setBusy(false);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                    {checklist?.enough ? "Gallery looks complete — more photos from the pages read:" : "Photos from the pages read — tick to add:"}
                </p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
                    {open ? "Hide" : `Show ${ordered.length}`}
                </Button>
            </div>
            {open && (
                <>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {ordered.map((s, idx) => {
                            const on = picked.has(s.url);
                            const fills = !!s.kind && missing.has(s.kind);
                            return (
                                <div key={s.url} className="group relative">
                                <button
                                    type="button"
                                    onClick={() => toggle(s.url)}
                                    className={`relative w-full overflow-hidden rounded-md border text-left ${on ? "border-primary ring-2 ring-primary" : "border-border"}`}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element -- a foreign site's photo, shown as is for picking */}
                                    <img src={s.url} alt={s.kind ? photoKindLabel(s.kind) : s.site} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full bg-muted object-contain" />
                                    {on && <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                                    <span className="block truncate px-1 text-[10px] text-muted-foreground">
                                        {s.kind ? <span className={fills ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{photoKindLabel(s.kind)} · </span> : null}
                                        {s.site}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewing(idx)}
                                    title="View large"
                                    aria-label="View photo large"
                                    className="absolute top-1 left-1 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm opacity-80 hover:opacity-100 group-hover:opacity-100"
                                >
                                    <ZoomIn className="size-4" />
                                </button>
                                </div>
                            );
                        })}
                    </div>
                    {viewing !== null && (
                        <ImageViewer
                            srcs={ordered.map((s) => s.url)}
                            startIndex={viewing}
                            alt="Suggested photo"
                            tools={false}
                            onClose={() => setViewing(null)}
                        />
                    )}
                    <Button type="button" size="sm" variant="outline" disabled={busy || picked.size === 0} onClick={() => void add()}>
                        <ImagePlus className="size-4" />
                        {busy ? "Adding…" : `Add ${picked.size || ""} to gallery`}
                    </Button>
                    <p className="text-muted-foreground text-[11px]">Seller photos may belong to that seller — the maker&apos;s site is the safe pick.</p>
                </>
            )}
        </div>
    );
}

/** The rows under Product image in Shop readiness, by group; must rows in bold. Staff tick a kind once the gallery has it. */
export function PhotoChecklistRows({ checklist, gallery, onToggle, onWaive, onWaiveMain, onRemove }: {
    checklist: PhotoChecklist;
    /** The form's current gallery — advice about a photo no longer there is not shown. */
    gallery: string[];
    onToggle: (kind: PhotoKind) => void;
    /** "Can't add" on a missing must photo (owner, 2026-11-18): it stops blocking the AI parts; the search looks for it online instead. */
    onWaive: (kind: PhotoKind) => void;
    /** "Can't do" on the clean main photo — e.g. every box already carries our price label. */
    onWaiveMain: () => void;
    onRemove: (url: string) => void;
}) {
    const removals = checklist.remove.filter((r) => gallery.includes(r.url));
    const groups = (Object.keys(PHOTO_GROUPS) as PhotoGroup[])
        .map((g) => ({ g, items: checklist.items.filter((i) => PHOTO_KINDS[i.kind].group === g) }))
        .filter((x) => x.items.length);
    return (
        <div className="ml-6 space-y-2">
            {(checklist.box || checklist.shape) && (
                <p className="text-muted-foreground text-[11px]">
                    {[checklist.box && BOX_TYPES[checklist.box], checklist.shape].filter(Boolean).join(" · ")}
                </p>
            )}
            {checklist.mainClean === false && (
                <div className="flex items-center gap-2 text-xs">
                    <span className={`font-medium ${checklist.mainWaived ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}>
                        Main photo is not a clean product photo{checklist.mainWaived ? "" : " · must"}
                    </span>
                    <label className="text-muted-foreground ml-auto flex items-center gap-1" title="No clean photo can be taken (e.g. every box already has our price label) — the AI stops asking for it">
                        <Checkbox checked={!!checklist.mainWaived} onCheckedChange={onWaiveMain} />
                        Can&apos;t do
                    </label>
                </div>
            )}
            {removals.length > 0 && (
                <div>
                    <p className="text-[11px] font-medium uppercase text-amber-700 dark:text-amber-400">AI suggests removing</p>
                    <ul className="space-y-1">
                        {removals.map((r) => (
                            <li key={r.url} className="flex items-center gap-2 text-xs">
                                {/* eslint-disable-next-line @next/next/no-img-element -- our own gallery photo, a tiny thumbnail */}
                                <img src={r.url} alt="" className="size-8 shrink-0 rounded border border-border bg-muted object-contain" />
                                <span className="min-w-0 flex-1">
                                    <span className="font-medium">{PHOTO_REMOVE_REASONS[r.why]}</span>
                                    {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                                </span>
                                <Button type="button" size="sm" variant="outline" onClick={() => onRemove(r.url)}>Remove</Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {groups.map(({ g, items }) => (
                <div key={g}>
                    <p className="text-muted-foreground text-[11px] font-medium uppercase">{PHOTO_GROUPS[g]}</p>
                    <ul className="space-y-1">
                        {items.map((i) => (
                            <li key={i.kind} className="flex items-center gap-2 text-xs">
                                <Checkbox id={`photo-${i.kind}`} checked={i.done} onCheckedChange={() => onToggle(i.kind)} />
                                <label htmlFor={`photo-${i.kind}`} className={`${i.must ? "font-medium" : ""} ${i.done ? "" : "text-muted-foreground"}`}>
                                    {photoKindLabel(i.kind)}
                                    {i.must && !i.done && !i.waived ? <span className="ml-1 text-amber-700 dark:text-amber-400">· must</span> : null}
                                </label>
                                {i.must && !i.done && (
                                    <label className="text-muted-foreground ml-auto flex items-center gap-1" title="This photo cannot be taken — the AI stops asking for it and looks for it online">
                                        <Checkbox checked={!!i.waived} onCheckedChange={() => onWaive(i.kind)} />
                                        Can&apos;t add
                                    </label>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            <p className="text-muted-foreground text-[11px]">
                {checklist.enough ? "AI: the must photos are there; the open rows add feel." : "AI: add the must rows first, then the rest for feel and impulse."}
            </p>
        </div>
    );
}

/**
 * Photo AI's arrangement (owner, 2026-10-22): a better order and look for our
 * gallery. "Each photo should be done by AI automatically": a look goes straight
 * onto every photo nobody has adjusted yet, with Undo; a photo staff framed keeps
 * its framing and gets an Apply button instead. The order stays a button. A look
 * is a normal Adjust edit; the gallery autosaves as usual.
 */
export function AiPhotoArrange({
    arrange,
    gallery,
    onGallery,
}: {
    arrange: PhotoArrange;
    gallery: string[];
    onGallery: (next: (g: string[]) => string[]) => void;
}) {
    // A look already applied changes that photo's URL — follow it, so the order still finds it.
    const now = (u: string) => {
        const look = arrange.looks.find((l) => l.url === u);
        return look && gallery.includes(look.next) ? look.next : u;
    };
    const order = arrange.order.map(now).filter((u) => gallery.includes(u));
    const orderDone = order.length < 2 || order.every((u, i) => gallery[i] === u);
    // Looks the AI put on by itself this session, and the ones staff undid (never re-applied).
    const [auto, setAuto] = useState<{ url: string; next: string; why: string }[]>([]);
    const declined = useRef(new Set<string>());
    // Once per AI answer; the gallery is read at that moment.
    const applyAiLooks = useEffectEvent(() => {
        const fresh = arrange.looks.filter((l) => gallery.includes(l.url) && withoutAdjust(l.url) === l.url && !declined.current.has(l.url));
        if (!fresh.length) return;
        onGallery((g) => g.map((u) => fresh.find((l) => l.url === u)?.next ?? u));
        setAuto((a) => [...a.filter((x) => !fresh.some((l) => l.url === x.url)), ...fresh]);
    });
    useEffect(() => { applyAiLooks(); }, [arrange]);
    const undo = (l: { url: string; next: string }) => {
        declined.current.add(l.url);
        onGallery((g) => g.map((u) => (u === l.next ? l.url : u)));
        setAuto((a) => a.filter((x) => x.url !== l.url));
    };
    const applied = auto.filter((l) => gallery.includes(l.next));
    const looks = arrange.looks.filter((l) => gallery.includes(l.url) && !applied.some((a) => a.url === l.url));
    if (orderDone && !looks.length && !applied.length) return null;

    const applyOrder = () => onGallery((g) => [...order.filter((u) => g.includes(u)), ...g.filter((u) => !order.includes(u))]);
    const applyLook = (url: string, next: string) => onGallery((g) => g.map((u) => (u === url ? next : u)));

    return (
        <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <p className="text-xs font-medium">AI suggests for your photos</p>
            {!orderDone && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs">Better order (first = shop card and search photo):</span>
                        <Button type="button" size="sm" variant="outline" onClick={applyOrder}>Apply order</Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {order.map((u, i) => (
                            <figure key={u} className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                                <img src={cloudinaryThumb(u, 96, "square")} alt="" className="size-12 rounded border object-cover" />
                                <span className="absolute top-0 left-0 rounded-br bg-primary px-1 text-[10px] text-primary-foreground">{i + 1}</span>
                            </figure>
                        ))}
                    </div>
                </div>
            )}
            {applied.length > 0 && (
                <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">AI improved {applied.length} photo{applied.length > 1 ? "s" : ""} — before → after:</span>
                    {applied.map((l) => (
                        <div key={l.url} className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                            <img src={cloudinaryThumb(l.url, 160, "card")} alt="Before" className="h-15 w-20 rounded border object-cover" />
                            <span className="text-muted-foreground text-xs">→</span>
                            {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                            <img src={cloudinaryThumb(l.next, 160, "card")} alt="After" className="h-15 w-20 rounded border object-cover" />
                            <span className="text-muted-foreground min-w-0 flex-1 text-xs">{l.why || describeLook(l.next)}</span>
                            <Button type="button" size="sm" variant="ghost" onClick={() => undo(l)}>Undo</Button>
                        </div>
                    ))}
                </div>
            )}
            {looks.length > 0 && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs">Better look — before → after:</span>
                        {looks.length > 1 && (
                            <Button type="button" size="sm" variant="outline" onClick={() => looks.forEach((l) => applyLook(l.url, l.next))}>Apply all</Button>
                        )}
                    </div>
                    {looks.map((l) => (
                        <div key={l.url} className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                            <img src={cloudinaryThumb(l.url, 160, "card")} alt="Before" className="h-15 w-20 rounded border object-cover" />
                            <span className="text-muted-foreground text-xs">→</span>
                            {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                            <img src={cloudinaryThumb(l.next, 160, "card")} alt="After" className="h-15 w-20 rounded border object-cover" />
                            <span className="text-muted-foreground min-w-0 flex-1 text-xs">{l.why || describeLook(l.next)}</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => applyLook(l.url, l.next)}>Apply</Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** "Fill · Sharpen" — when the AI gave no reason. */
function describeLook(url: string): string {
    const a = readAdjust(url);
    return [
        a.crop[0].toUpperCase() + a.crop.slice(1),
        ...(a.crop === "pad" && a.padBg === "white" ? [PAD_BACKGROUNDS.white] : []),
        ...(a.rotate ? [`Rotate ${a.rotate}°`] : []),
        ...(a.fixes ?? []).map((f) => IMAGE_FIXES[f]),
    ].join(" · ");
}
