"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { PHOTO_KINDS, type PhotoChecklist, type PhotoKind, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";

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
    // Photos that fill a gap first.
    const ordered = [...suggestions].sort((a, b) => Number(!!b.kind && missing.has(b.kind)) - Number(!!a.kind && missing.has(a.kind)));
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
                return { url: await uploadImageToCloudinary(s.url, "/api/upload-signature", "shop/products"), kind: s.kind };
            } catch {
                return null;
            }
        }));
        const ok = done.filter((d): d is { url: string; kind: PhotoKind | null } => d !== null);
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
                                    <img src={s.url} alt={s.kind ? PHOTO_KINDS[s.kind] : s.site} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full bg-muted object-contain" />
                                    {on && <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                                    <span className="block truncate px-1 text-[10px] text-muted-foreground">
                                        {s.kind ? <span className={fills ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{PHOTO_KINDS[s.kind]} · </span> : null}
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

/** The rows under Product image in Shop readiness. Staff tick a kind once the gallery has it. */
export function PhotoChecklistRows({ checklist, onToggle }: { checklist: PhotoChecklist; onToggle: (kind: PhotoKind) => void }) {
    return (
        <ul className="ml-6 space-y-1">
            {checklist.items.map((i) => (
                <li key={i.kind} className="flex items-center gap-2 text-xs">
                    <Checkbox id={`photo-${i.kind}`} checked={i.done} onCheckedChange={() => onToggle(i.kind)} />
                    <label htmlFor={`photo-${i.kind}`} className={i.done ? "" : "text-muted-foreground"}>{PHOTO_KINDS[i.kind]}</label>
                </li>
            ))}
            <li className="text-muted-foreground text-[11px]">
                {checklist.enough ? "AI: the gallery is enough; the open rows are nice to have." : "AI: add the open rows for buyers and search."}
            </li>
        </ul>
    );
}
