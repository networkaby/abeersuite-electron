"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ImageOff, Loader2, Trash2 } from "lucide-react";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { useShopMasters } from "../hooks/useShopMasters";
import { PHOTO_KIND_LABEL, type MasterPhotoKind } from "../lib/shopPhotos";
import { uploadShopPhoto } from "../lib/uploadShopPhoto";
import type { MasterPhoto } from "../lib/types";
import MobileHeader from "./MobileHeader";
import PhotoPickButtons from "./PhotoPickButtons";
import { photosHref } from "./MobilePhotos";

/**
 * A brand's, group's or category's one shop image — its storefront tile. A new
 * photo replaces the old one; Remove clears it. Name, slug and description stay
 * with the office (Ecommerce → Masters).
 */
export default function MobileMasterPhoto({ kind, id }: { kind: MasterPhotoKind; id: number }) {
    const { masters, loading, refresh } = useShopMasters();
    const row = masters?.[kind].find((m) => m.id === id) ?? null;
    const label = PHOTO_KIND_LABEL[kind];
    // This screen's own last save wins over the held row until the row catches up.
    const [saved, setSaved] = useState<string | null | undefined>(undefined);
    const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

    const save = async (imageUrl: string | null) => {
        const done = (await axios.patch<MasterPhoto>(`/api/mobile/photos/master/${kind}/${id}`, { imageUrl })).data;
        setSaved(done.imageUrl);
        void refresh();
    };

    const replace = async (file: File) => {
        setError(null);
        setConfirmRemove(false);
        setPreview({ url: URL.createObjectURL(file), file });
        setBusy(true);
        try {
            await save(await uploadShopPhoto(file, kind));
            setPreview(null);
        } catch (e) {
            setError(e instanceof Error && !axios.isAxiosError(e) ? e.message : extractApiError(e, "Could not save the image."));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!confirmRemove) { setConfirmRemove(true); return; }
        setBusy(true);
        setError(null);
        try {
            await save(null);
        } catch (e) {
            setError(extractApiError(e, "Could not remove the image."));
        } finally {
            setBusy(false);
            setConfirmRemove(false);
        }
    };

    const current = saved !== undefined ? saved : row?.imageUrl ?? null;

    return (
        <>
            <MobileHeader title={row ? `${label}: ${row.name}` : label} back={photosHref(kind)} onRefresh={() => void refresh()} busy={loading} />
            <div className="space-y-4 p-3">
                {!loading && masters && !row && <p className="text-sm text-destructive">This {label.toLowerCase()} was not found. It may have been deleted.</p>}

                <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
                    {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                        <img src={preview.url} alt="" className="size-full object-cover opacity-60" />
                    ) : current ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary image
                        <img src={cloudinaryThumb(current, 720)} alt="" className="size-full object-cover" />
                    ) : (
                        <span className="flex flex-col items-center gap-1 text-sm">
                            <ImageOff className="size-8" aria-hidden /> No image yet
                        </span>
                    )}
                    {busy && preview && <Loader2 className="absolute size-8 animate-spin text-foreground" aria-label="Uploading" />}
                </div>

                {error && (
                    <p className="text-sm text-destructive">
                        {error}{" "}
                        {preview && <button type="button" onClick={() => void replace(preview.file)} className="font-medium underline">Retry</button>}
                    </p>
                )}

                <PhotoPickButtons multiple={false} disabled={busy || !row} onFiles={(files) => void replace(files[0])} />

                {current && !preview && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove()}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm disabled:opacity-40 ${confirmRemove ? "border-destructive bg-destructive text-white" : "text-destructive active:bg-muted"}`}
                    >
                        <Trash2 className="size-4" aria-hidden /> {confirmRemove ? "Tap again to remove" : "Remove image"}
                    </button>
                )}

                <p className="text-xs text-muted-foreground">
                    One image for this {label.toLowerCase()}&apos;s tile on the shop. A new photo replaces the old one.
                </p>
            </div>
        </>
    );
}
