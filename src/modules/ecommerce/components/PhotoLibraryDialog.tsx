"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { PHOTO_CLEANUP_MIN_AGE_DAYS } from "@/shared/lib/constants/inventory";
import type { LibraryPhoto } from "@/modules/ecommerce/lib/photoCleanup";

const PAGE = 48;

/**
 * "From library" — pick photos already in Cloudinary (removed from a product,
 * never saved, or on another product) and add them without uploading again.
 * The same file is linked, so nothing new is stored.
 */
export default function PhotoLibraryDialog({
    open,
    onOpenChange,
    exclude,
    onAdd,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Photos already on this product — shown as added, not pickable. */
    exclude: string[];
    onAdd: (urls: string[]) => void;
}) {
    const [photos, setPhotos] = useState<LibraryPhoto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<"unused" | "all">("unused");
    const [shown, setShown] = useState(PAGE);
    const [picked, setPicked] = useState<string[]>([]);

    useEffect(() => {
        if (!open) return;
        setPicked([]);
        setShown(PAGE);
        setError(null);
        axios
            .get<{ photos: LibraryPhoto[] }>("/api/ecommerce/photo-library")
            .then((r) => setPhotos(r.data.photos))
            .catch((e: unknown) => setError(extractApiError(e, "Could not load the photo library")));
    }, [open]);

    // A photo on this product matches by file, whatever Adjust did to its link.
    const onThis = (p: LibraryPhoto) => exclude.some((u) => u.includes(p.publicId));
    const list = (photos ?? []).filter((p) => (tab === "unused" ? !p.used : true));
    const toggle = (url: string) => setPicked((s) => (s.includes(url) ? s.filter((u) => u !== url) : [...s, url]));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Photo library</DialogTitle>
                    <DialogDescription>
                        Photos already in Cloudinary — add them without uploading again. An unused photo older than{" "}
                        {PHOTO_CLEANUP_MIN_AGE_DAYS} days can be deleted by Photo cleanup, so reuse it soon.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-2">
                    {(["unused", "all"] as const).map((t) => (
                        <Button key={t} type="button" size="sm" variant={tab === t ? "default" : "outline"} onClick={() => { setTab(t); setShown(PAGE); }}>
                            {t === "unused" ? "Unused" : "All"}
                            {photos && ` (${t === "unused" ? photos.filter((p) => !p.used).length : photos.length})`}
                        </Button>
                    ))}
                </div>

                <div className="max-h-[60vh] overflow-y-auto">
                    {error ? (
                        <p className="text-sm text-destructive">{error}</p>
                    ) : !photos ? (
                        <Loader2 className="mx-auto my-10 size-6 animate-spin text-muted-foreground" aria-label="Loading" />
                    ) : list.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No photos here.</p>
                    ) : (
                        <>
                            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                                {list.slice(0, shown).map((p) => {
                                    const added = onThis(p);
                                    const on = picked.includes(p.url);
                                    return (
                                        <li key={p.publicId}>
                                            <button
                                                type="button"
                                                disabled={added}
                                                onClick={() => toggle(p.url)}
                                                title={`${p.publicId} · ${p.createdAt.slice(0, 10)}${p.used ? " · in use" : ""}`}
                                                aria-pressed={on}
                                                className={`relative block aspect-square w-full overflow-hidden rounded border bg-muted disabled:opacity-40 ${on ? "ring-2 ring-primary" : ""}`}
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary thumb */}
                                                <img src={cloudinaryThumb(p.url, 160, "card")} alt="" loading="lazy" className="size-full object-cover" />
                                                {on && (
                                                    <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                                                        <Check className="size-3" />
                                                    </span>
                                                )}
                                                {added && <span className="absolute inset-x-0 bottom-0 bg-background/90 text-[10px]">On this product</span>}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            {list.length > shown && (
                                <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => setShown((n) => n + PAGE)}>
                                    Show more ({list.length - shown} left)
                                </Button>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                        type="button"
                        disabled={picked.length === 0}
                        onClick={() => { onAdd(picked); onOpenChange(false); }}
                    >
                        Add {picked.length > 0 ? picked.length : ""} photo{picked.length === 1 ? "" : "s"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
