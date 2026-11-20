"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Crop, Eraser, EyeOff, SquarePen, Images, Link2, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { isAiSkipped, setAiSkipped } from "@/shared/lib/shop/photoMark";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { cloudinaryThumb, isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
import ImageAdjustDialog from "@/modules/ecommerce/components/ImageAdjustDialog";
import PhotoCleanUpDialog from "@/modules/ecommerce/components/PhotoCleanUpDialog";
import PhotoEditorDialog from "@/modules/ecommerce/components/PhotoEditorDialog";
import PhotoLibraryDialog from "@/modules/ecommerce/components/PhotoLibraryDialog";

export default function ProductGalleryUploader({
    urls,
    onChange,
    selected: selectedProp,
    onSelectedChange,
}: {
    urls: string[];
    onChange: (urls: string[]) => void;
    /**
     * Which photo the action row acts on — controlled, so a parent (e.g. the
     * live preview card) can show the same photo the user has selected here.
     * Uncontrolled (self-managed) when omitted.
     */
    selected?: number;
    onSelectedChange?: (idx: number) => void;
}) {
    const [uploading, setUploading] = useState(false);
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [urlValue, setUrlValue] = useState("");
    const [adjustIdx, setAdjustIdx] = useState<number | null>(null);
    const [editIdx, setEditIdx] = useState<number | null>(null);
    const [cleanIdx, setCleanIdx] = useState<number | null>(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [selectedState, setSelectedState] = useState(0);
    const selected = selectedProp ?? selectedState;
    const setSelected = useCallback(
        (next: number | ((s: number) => number)) => {
            const resolved = typeof next === "function" ? next(selected) : next;
            setSelectedState(resolved);
            onSelectedChange?.(resolved);
        },
        [selected, onSelectedChange]
    );
    const hasSelection = selected < urls.length;

    const uploadSource = useCallback(
        async (source: File | string) => {
            setUploading(true);
            try {
                const secureUrl = await uploadImageToCloudinary(source, "/api/upload-signature", "shop/products");
                onChange([...urls, secureUrl]);
                setSelected(urls.length); // select what was just added
                toast.success("Image uploaded");
            } catch (err) {
                const detail = axios.isAxiosError(err)
                    ? (err.response?.data as { error?: { message?: string } | string } | undefined)
                    : undefined;
                const message =
                    (typeof detail?.error === "string" ? detail.error : detail?.error?.message)
                    ?? (err instanceof Error ? err.message : "unknown error");
                toast.error(`Upload failed — ${message}`);
                console.error("Cloudinary upload failed:", err);
            } finally {
                setUploading(false);
            }
        },
        [onChange, urls, setSelected]
    );

    const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void uploadSource(f);
    };

    const addFromUrl = () => {
        const trimmed = urlValue.trim();
        if (!trimmed) return;
        void uploadSource(trimmed).then(() => {
            setUrlValue("");
            setShowUrlInput(false);
        });
    };

    const removeAt = (idx: number) => {
        const next = urls.filter((_, i) => i !== idx);
        onChange(next);
        setSelected((s) => Math.max(0, Math.min(s > idx ? s - 1 : s, next.length - 1)));
    };

    /** Index 0 is the primary image everywhere on the shop — this is how it is chosen. */
    const makePrimary = (idx: number) => {
        if (idx === 0) return;
        const next = [...urls];
        const [picked] = next.splice(idx, 1);
        onChange([picked, ...next]);
        setSelected(0); // selection follows the photo that moved
    };

    const move = (idx: number, dir: -1 | 1) => {
        const to = idx + dir;
        if (to < 0 || to >= urls.length) return;
        const next = [...urls];
        [next[idx], next[to]] = [next[to], next[idx]];
        onChange(next);
        setSelected(to); // selection follows the photo that moved
    };

    const replaceAt = (idx: number, url: string) => {
        onChange(urls.map((u, i) => (i === idx ? url : u)));
    };

    return (
        <div className="space-y-3">
            {/* Thumbs are selection only — every action lives in the single row below. */}
            <div className="flex flex-wrap gap-2">
                {urls.map((url, i) => (
                    <button
                        key={`${url}-${i}`}
                        type="button"
                        onClick={() => setSelected(i)}
                        aria-label={`Select photo ${i + 1}`}
                        aria-pressed={selected === i}
                        className={`relative h-20 w-24 shrink-0 overflow-hidden rounded-md border bg-muted transition-colors ${selected === i ? "ring-2 ring-primary" : "hover:border-foreground/40"
                            }`}
                    >
                        {/* Shown in the card frame, so the tile previews the real shop framing. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cloudinaryThumb(url, 224, "card")} alt="" className="size-full object-cover" />
                        {i === 0 ? (
                            <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-primary px-1 py-0.5 text-[10px] font-medium text-primary-foreground">
                                <Star className="size-3 fill-current" />
                                Primary
                            </span>
                        ) : (
                            <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px]">{i + 1}</span>
                        )}
                        {isAiSkipped(url) && (
                            <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-background/90 px-1 text-[10px] text-muted-foreground">
                                <EyeOff className="size-3" />
                                AI skip
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <input type="file" accept="image/*" className="hidden" id="gallery-upload" onChange={onPick} />
                    <Button type="button" variant="outline" size="sm" disabled={uploading} asChild>
                        <label htmlFor="gallery-upload" className="cursor-pointer">
                            <Upload className="mr-2 size-4" />
                            {uploading ? "Uploading…" : "Add"}
                        </label>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploading}
                        onClick={() => setShowUrlInput((v) => !v)}
                    >
                        <Link2 className="mr-2 size-4" />
                        From URL
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => setLibraryOpen(true)}>
                        <Images className="mr-2 size-4" />
                        From library
                    </Button>

                    {hasSelection ? (
                        <>
                            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title={
                                    isCloudinaryUrl(urls[selected])
                                        ? "Adjust framing"
                                        : "Only uploaded images can be adjusted"
                                }
                                disabled={!isCloudinaryUrl(urls[selected])}
                                onClick={() => setAdjustIdx(selected)}
                            >
                                <Crop className="mr-2 size-4" />
                                Adjust
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title={
                                    isCloudinaryUrl(urls[selected])
                                        ? "Edit photo — crop, rotate, light, text, blur; saves a new copy"
                                        : "Only uploaded images can be edited"
                                }
                                disabled={uploading || !isCloudinaryUrl(urls[selected])}
                                onClick={() => setEditIdx(selected)}
                            >
                                <SquarePen className="mr-2 size-4" />
                                Edit photo
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title={
                                    isCloudinaryUrl(urls[selected])
                                        ? "Clean up — product onto white, fills the frame, soft shadow; saves a new copy"
                                        : "Only uploaded images can be cleaned up"
                                }
                                disabled={uploading || !isCloudinaryUrl(urls[selected])}
                                onClick={() => setCleanIdx(selected)}
                            >
                                <Eraser className="mr-2 size-4" />
                                Clean up
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={selected === 0}
                                onClick={() => makePrimary(selected)}
                            >
                                <Star className="mr-2 size-4" />
                                Make primary
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-8"
                                title="Move earlier"
                                disabled={selected === 0}
                                onClick={() => move(selected, -1)}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-8"
                                title="Move later"
                                disabled={selected === urls.length - 1}
                                onClick={() => move(selected, 1)}
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title="Skipped photos are not sent to AI — saves time and cost (ads, duplicates, other products)"
                                onClick={() => replaceAt(selected, setAiSkipped(urls[selected], !isAiSkipped(urls[selected])))}
                            >
                                {isAiSkipped(urls[selected])
                                    ? <><Sparkles className="mr-2 size-4" />Use for AI</>
                                    : <><EyeOff className="mr-2 size-4" />Skip for AI</>}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => removeAt(selected)}
                            >
                                <Trash2 className="mr-2 size-4" />
                                Delete
                            </Button>
                        </>
                    ) : null}
                </div>
                {showUrlInput && (
                    <div className="flex max-w-md gap-2">
                        <Input
                            type="url"
                            placeholder="https://example.com/image.jpg"
                            value={urlValue}
                            onChange={(e) => setUrlValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addFromUrl();
                                }
                            }}
                            disabled={uploading}
                        />
                        <Button type="button" disabled={uploading || !urlValue.trim()} onClick={addFromUrl}>
                            {uploading ? "Fetching…" : "Fetch"}
                        </Button>
                    </div>
                )}
            </div>
            <PhotoLibraryDialog
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                exclude={urls}
                onAdd={(picked) => {
                    onChange([...urls, ...picked.filter((u) => !urls.includes(u))]);
                    setSelected(urls.length);
                }}
            />
            {adjustIdx !== null && urls[adjustIdx] ? (
                <ImageAdjustDialog
                    key={adjustIdx}
                    url={urls[adjustIdx]}
                    open
                    onOpenChange={(o) => !o && setAdjustIdx(null)}
                    onSave={(next) => replaceAt(adjustIdx, next)}
                />
            ) : null}
            {cleanIdx !== null && urls[cleanIdx] ? (
                <PhotoCleanUpDialog
                    key={`clean-${cleanIdx}`}
                    url={urls[cleanIdx]}
                    onClose={() => setCleanIdx(null)}
                    onSave={(next) => replaceAt(cleanIdx, next)}
                />
            ) : null}
            {editIdx !== null && urls[editIdx] ? (
                <PhotoEditorDialog
                    key={`edit-${editIdx}`}
                    url={urls[editIdx]}
                    onClose={() => setEditIdx(null)}
                    onSave={(next) => replaceAt(editIdx, next)}
                />
            ) : null}
        </div>
    );
}
