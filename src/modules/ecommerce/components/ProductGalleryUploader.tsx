"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { GripVertical, Link2, Trash2, Upload } from "lucide-react";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";

export default function ProductGalleryUploader({
    urls,
    onChange,
}: {
    urls: string[];
    onChange: (urls: string[]) => void;
}) {
    const [uploading, setUploading] = useState(false);
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [urlValue, setUrlValue] = useState("");

    const uploadSource = useCallback(
        async (source: File | string) => {
            setUploading(true);
            try {
                const secureUrl = await uploadImageToCloudinary(source, "/api/upload-signature", "shop/products");
                onChange([...urls, secureUrl]);
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
        [onChange, urls]
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
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                {urls.map((url, i) => (
                    <div
                        key={`${url}-${i}`}
                        className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border bg-muted"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
                        <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute right-1 bottom-1 size-7"
                            onClick={() => removeAt(i)}
                        >
                            <Trash2 className="size-3.5" />
                        </Button>
                        <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px]">
                            <GripVertical className="inline size-3" />
                            {i + 1}
                        </span>
                    </div>
                ))}
            </div>
            <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                    <input type="file" accept="image/*" className="hidden" id="gallery-upload" onChange={onPick} />
                    <Button type="button" variant="outline" disabled={uploading} asChild>
                        <label htmlFor="gallery-upload" className="cursor-pointer">
                            <Upload className="mr-2 size-4" />
                            {uploading ? "Uploading…" : "Add image"}
                        </label>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => setShowUrlInput((v) => !v)}
                    >
                        <Link2 className="mr-2 size-4" />
                        Add from URL
                    </Button>
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
        </div>
    );
}
