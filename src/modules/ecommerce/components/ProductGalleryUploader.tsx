"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GripVertical, Trash2, Upload } from "lucide-react";

type Sig = {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
};

export default function ProductGalleryUploader({
    urls,
    onChange,
}: {
    urls: string[];
    onChange: (urls: string[]) => void;
}) {
    const [uploading, setUploading] = useState(false);

    const uploadFile = useCallback(
        async (file: File) => {
            setUploading(true);
            try {
                const sigRes = await axios.get<Sig>("/api/upload-signature", {
                    params: { folder: "shop/products" },
                });
                const { timestamp, signature, apiKey, cloudName, folder } = sigRes.data;
                const fd = new FormData();
                fd.append("file", file);
                fd.append("api_key", apiKey);
                fd.append("timestamp", String(timestamp));
                fd.append("signature", signature);
                fd.append("folder", folder);

                const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
                const up = await axios.post<{ secure_url: string }>(endpoint, fd);
                const next = [...urls, up.data.secure_url];
                onChange(next);
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
        if (f) void uploadFile(f);
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
            <div>
                <input type="file" accept="image/*" className="hidden" id="gallery-upload" onChange={onPick} />
                <Button type="button" variant="outline" disabled={uploading} asChild>
                    <label htmlFor="gallery-upload" className="cursor-pointer">
                        <Upload className="mr-2 size-4" />
                        {uploading ? "Uploading…" : "Add image"}
                    </label>
                </Button>
            </div>
        </div>
    );
}
