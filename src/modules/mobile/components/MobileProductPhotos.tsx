"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { EyeOff, Loader2, RotateCw, Sparkles, Star, Trash2, X } from "lucide-react";
import { invalidateProductCatalog, useProductCatalog } from "@/shared/hooks/useProductCatalog";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { isAiSkipped, setAiSkipped } from "@/shared/lib/shop/photoMark";
import { MAX_PRODUCT_PHOTOS } from "@/shared/lib/constants/inventory";
import { uploadShopPhoto } from "../lib/uploadShopPhoto";
import { forgetUnsaved, isNoAnswer, readUnsaved, rememberUnsaved, saveFailureText } from "../lib/unsavedPhotos";
import type { ProductPhotos } from "../lib/types";
import MobileHeader from "./MobileHeader";
import PhotoPickButtons from "./PhotoPickButtons";
import { photosHref } from "./MobilePhotos";
import { useValueChange } from "@/shared/hooks/useValueChange";

/** A photo on its way: shown at once from the phone, then uploaded, then saved. */
type Pending = { key: number; file: File; preview: string; url?: string; error?: string; aiSkip: boolean };
type CatalogueRow = { id: number; name: string; imageUrl?: string | null };

const api = (id: number) => `/api/mobile/photos/product/${id}`;
/** Waits before each automatic re-try of a save that got no answer. */
const RETRY_DELAYS_MS = [2000, 5000, 10000];

/** Attach uploaded photos, trying again by itself while the network gives no answer. */
async function attach(id: number, urls: string[]): Promise<ProductPhotos> {
    for (let i = 0; ; i++) {
        try {
            return (await axios.patch<ProductPhotos>(api(id), { add: urls })).data;
        } catch (e) {
            if (!isNoAnswer(e) || i >= RETRY_DELAYS_MS.length) throw e;
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
        }
    }
}

/**
 * One product's shop photos on the phone: take or pick photos (each is shrunk,
 * uploaded and saved as soon as it is ready, so one bad signal loses one photo,
 * not the batch), choose the main one, remove one. Framing (Adjust) stays on the
 * office product page.
 *
 * Saves go through the office product page's own save, so a photo that makes the
 * product shop-ready lists it — the screen says so when that happens.
 */
export default function MobileProductPhotos({ id }: { id: number }) {
    const { products } = useProductCatalog<CatalogueRow>();
    const known = products.find((p) => p.id === id);
    const [data, setData] = useState<ProductPhotos | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState<Pending[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; tone: "good" | "warn" | "bad" } | null>(null);
    // Chosen before taking photos: ads, duplicates or other products need not go to AI.
    const [skipNewForAi, setSkipNewForAi] = useState(false);
    const nextKey = useRef(1);
    const previews = useRef(new Set<string>());

    const read = useCallback(() => axios.get<ProductPhotos>(api(id))
        .then(({ data: loaded }) => {
            setData(loaded);
            // Photos uploaded earlier whose attach never got an answer — finish the job.
            forgetUnsaved(id, loaded.galleryUrls);
            const left = readUnsaved(id);
            if (!left.length) return;
            setNote({ text: `Attaching ${left.length} photo${left.length > 1 ? "s" : ""} uploaded earlier…`, tone: "warn" });
            return attach(id, left).then(
                (saved) => {
                    forgetUnsaved(id, left);
                    setData(saved);
                    setNote({ text: "Earlier photos attached.", tone: "good" });
                    void invalidateProductCatalog();
                },
                (e) => {
                    // A refusal (photo limit, not ours) will not change on retry — let it go.
                    if (!isNoAnswer(e)) forgetUnsaved(id, left);
                    setNote({ text: saveFailureText(e), tone: "bad" });
                },
            );
        })
        .catch((e) => { setLoadError(extractApiError(e, "Could not load the photos.")); })
        .finally(() => setLoading(false)), [id]);
    /** Refresh: the spinner and a clean error first, then the read. */
    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        await read();
    }, [read]);

    // Another product: spinner on, error cleared — while rendering (both start that way).
    if (useValueChange(id)) {
        setLoading(true);
        setLoadError(null);
    }
    useEffect(() => { void read(); }, [read]);
    useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

    /** The server's answer after any change — plus a line when the shop listing moved. */
    const applySaved = (saved: ProductPhotos) => {
        setData(saved);
        if (saved.wasListedInShop === false && saved.isListedInShop) setNote({ text: "Shop-ready — now live on the shop.", tone: "good" });
        else if (saved.wasListedInShop && !saved.isListedInShop) setNote({ text: "Taken off the shop — a product needs a photo there.", tone: "warn" });
        void invalidateProductCatalog();
    };

    const send = async (item: Pending) => {
        setPending((list) => list.map((p) => (p.key === item.key ? { ...p, error: undefined } : p)));
        try {
            const url = item.url ?? setAiSkipped(await uploadShopPhoto(item.file, "product"), item.aiSkip);
            // Remember the upload, so Retry after a failed save does not send the photo again.
            setPending((list) => list.map((p) => (p.key === item.key ? { ...p, url } : p)));
            rememberUnsaved(id, url);
            const saved = await attach(id, [url]);
            forgetUnsaved(id, [url]);
            applySaved(saved);
            setPending((list) => list.filter((p) => p.key !== item.key));
            URL.revokeObjectURL(item.preview);
            previews.current.delete(item.preview);
        } catch (e) {
            const error = e instanceof Error && !axios.isAxiosError(e) ? e.message : saveFailureText(e);
            setPending((list) => list.map((p) => (p.key === item.key ? { ...p, error } : p)));
        }
    };

    const addFiles = async (files: File[]) => {
        setNote(null);
        const room = MAX_PRODUCT_PHOTOS - (data?.galleryUrls.length ?? 0) - pending.length;
        if (room <= 0) {
            setNote({ text: `A product can hold ${MAX_PRODUCT_PHOTOS} photos from the phone. Remove one first.`, tone: "bad" });
            return;
        }
        if (files.length > room) setNote({ text: `Only the first ${room} added — ${MAX_PRODUCT_PHOTOS} photos is the most.`, tone: "warn" });
        const items = files.slice(0, room).map((file) => {
            const preview = URL.createObjectURL(file);
            previews.current.add(preview);
            return { key: nextKey.current++, file, preview, aiSkip: skipNewForAi };
        });
        setPending((list) => [...list, ...items]);
        // One at a time: on mobile data, parallel uploads only make each one slower.
        for (const item of items) await send(item);
    };

    const discard = (item: Pending) => {
        if (item.url) forgetUnsaved(id, [item.url]);
        setPending((list) => list.filter((p) => p.key !== item.key));
        URL.revokeObjectURL(item.preview);
        previews.current.delete(item.preview);
    };

    const change = async (body: { makeMain: string } | { remove: string } | { aiSkip: string; skip: boolean }) => {
        setBusy(true);
        setNote(null);
        try {
            applySaved((await axios.patch<ProductPhotos>(api(id), body)).data);
            setSelected(null);
        } catch (e) {
            setNote({ text: extractApiError(e, "Could not save the change."), tone: "bad" });
        } finally {
            setBusy(false);
            setConfirmRemove(false);
        }
    };

    const photos = data?.galleryUrls ?? (known?.imageUrl ? [known.imageUrl] : []);
    const title = data?.name ?? known?.name ?? "Product photos";
    const sel = selected && photos.includes(selected) ? selected : null;
    const uploading = pending.some((p) => !p.error);

    return (
        <>
            <MobileHeader title={title} back={photosHref("product")} onRefresh={() => void load()} busy={loading} />
            <div className="space-y-4 p-3">
                {loadError && <p className="text-sm text-destructive">{loadError}</p>}
                {data && (
                    <p className="text-sm text-muted-foreground">
                        {data.sku} · {data.isListedInShop ? "Live on the shop" : "Not on the shop yet"}
                    </p>
                )}

                <ul className="grid grid-cols-3 gap-2">
                    {photos.map((url, i) => (
                        <li key={url}>
                            <button
                                type="button"
                                onClick={() => { setSelected(sel === url ? null : url); setConfirmRemove(false); }}
                                aria-pressed={sel === url}
                                aria-label={i === 0 ? "Main photo" : `Photo ${i + 1}`}
                                className={`relative block aspect-[4/3] w-full overflow-hidden rounded-md border bg-muted ${sel === url ? "ring-2 ring-primary" : ""}`}
                            >
                                {/* In the shop card's frame, so the tile previews the real listing. */}
                                {/* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary thumb */}
                                <img src={cloudinaryThumb(url, 320, "card")} alt="" className="size-full object-cover" />
                                {i === 0 && (
                                    <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                                        <Star className="size-3 fill-current" aria-hidden /> Main
                                    </span>
                                )}
                                {isAiSkipped(url) && (
                                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-background/90 px-1 text-[10px] text-muted-foreground">
                                        <EyeOff className="size-3" aria-hidden /> AI skip
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                    {pending.map((p) => (
                        <li key={p.key} className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                            <img src={p.preview} alt="" className={`size-full object-cover ${p.error ? "opacity-40" : "opacity-60"}`} />
                            {p.error ? (
                                <span className="absolute inset-0 flex items-center justify-center gap-1">
                                    <button type="button" onClick={() => void send(p)} className="rounded-full bg-background p-2" aria-label="Retry">
                                        <RotateCw className="size-4" />
                                    </button>
                                    <button type="button" onClick={() => discard(p)} className="rounded-full bg-background p-2" aria-label="Discard">
                                        <X className="size-4" />
                                    </button>
                                </span>
                            ) : (
                                <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-foreground" aria-label="Uploading" />
                            )}
                        </li>
                    ))}
                </ul>
                {!loading && photos.length === 0 && pending.length === 0 && (
                    <p className="text-sm text-muted-foreground">No photo yet. The first one you add becomes the main photo on the shop.</p>
                )}
                {pending.find((p) => p.error) && <p className="text-sm text-destructive">{pending.find((p) => p.error)!.error}</p>}
                {note && (
                    <p className={`rounded-md px-3 py-2 text-sm ${note.tone === "good" ? "bg-green-500/10 text-green-700 dark:text-green-400" : note.tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-destructive/10 text-destructive"}`}>
                        {note.text}
                    </p>
                )}

                <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                    <span>
                        New photos: <b>{skipNewForAi ? "Skip for AI" : "For AI"}</b>
                        <span className="block text-xs text-muted-foreground">Skip ads, duplicates or other products — saves AI time and cost.</span>
                    </span>
                    <input
                        type="checkbox"
                        className="size-5"
                        checked={skipNewForAi}
                        onChange={(e) => setSkipNewForAi(e.target.checked)}
                        aria-label="Skip new photos for AI"
                    />
                </label>
                <PhotoPickButtons multiple disabled={!data || uploading} onFiles={(files) => void addFiles(files)} />

                {sel && (
                    <div className="space-y-2 border-t pt-3">
                        <p className="text-xs text-muted-foreground">{photos[0] === sel ? "Main photo" : `Photo ${photos.indexOf(sel) + 1}`} selected</p>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void change({ aiSkip: sel, skip: !isAiSkipped(sel) })}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm active:bg-muted disabled:opacity-40"
                        >
                            {isAiSkipped(sel)
                                ? <><Sparkles className="size-4" aria-hidden /> Use for AI</>
                                : <><EyeOff className="size-4" aria-hidden /> Skip for AI</>}
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                disabled={busy || photos[0] === sel}
                                onClick={() => void change({ makeMain: sel })}
                                className="flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm active:bg-muted disabled:opacity-40"
                            >
                                <Star className="size-4" aria-hidden /> Make main
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => (confirmRemove ? void change({ remove: sel }) : setConfirmRemove(true))}
                                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm disabled:opacity-40 ${confirmRemove ? "border-destructive bg-destructive text-white" : "text-destructive active:bg-muted"}`}
                            >
                                <Trash2 className="size-4" aria-hidden /> {confirmRemove ? "Tap again to remove" : "Remove"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
