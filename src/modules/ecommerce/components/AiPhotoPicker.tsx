"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { PHOTO_GROUPS, PHOTO_KINDS, PHOTO_REMOVE_REASONS, photoKindLabel, type PhotoChecklist, type PhotoGroup, type PhotoKind, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

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
                        {ordered.map((s) => {
                            const on = picked.has(s.url);
                            const fills = !!s.kind && missing.has(s.kind);
                            return (
                                <button
                                    key={s.url}
                                    type="button"
                                    onClick={() => toggle(s.url)}
                                    className={`relative overflow-hidden rounded-md border text-left ${on ? "border-primary ring-2 ring-primary" : "border-border"}`}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element -- a foreign site's photo, shown as is for picking */}
                                    <img src={s.url} alt={s.kind ? photoKindLabel(s.kind) : s.site} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full bg-muted object-contain" />
                                    {on && <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                                    <span className="block truncate px-1 text-[10px] text-muted-foreground">
                                        {s.kind ? <span className={fills ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{photoKindLabel(s.kind)} · </span> : null}
                                        {s.site}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
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
export function PhotoChecklistRows({ checklist, gallery, onToggle, onRemove }: {
    checklist: PhotoChecklist;
    /** The form's current gallery — advice about a photo no longer there is not shown. */
    gallery: string[];
    onToggle: (kind: PhotoKind) => void;
    onRemove: (url: string) => void;
}) {
    const removals = checklist.remove.filter((r) => gallery.includes(r.url));
    const groups = (Object.keys(PHOTO_GROUPS) as PhotoGroup[])
        .map((g) => ({ g, items: checklist.items.filter((i) => PHOTO_KINDS[i.kind].group === g) }))
        .filter((x) => x.items.length);
    return (
        <div className="ml-6 space-y-2">
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
                                    {i.must && !i.done ? <span className="ml-1 text-amber-700 dark:text-amber-400">· must</span> : null}
                                </label>
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
