"use client";

import { useCallback, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";

/**
 * One-image field: square preview + Upload button + a paste-URL fallback.
 *
 * The multi-photo `ProductGalleryUploader` doesn't fit here — a brand logo or a
 * category tile is exactly one image, not a reorderable gallery. Shares the
 * same upload primitive (`uploadImageToCloudinary`) and Cloudinary folder
 * convention (`shop/<kind>`) as the product gallery, just for a single slot.
 */
export default function ShopImageField({
    label,
    value,
    onChange,
    folder,
}: {
    label: string;
    value: string | null;
    onChange: (url: string | null) => void;
    /** Cloudinary folder, e.g. "shop/brands", "shop/groups". */
    folder: string;
}) {
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const upload = useCallback(
        async (file: File) => {
            setUploading(true);
            try {
                const url = await uploadImageToCloudinary(file, "/api/upload-signature", folder);
                onChange(url);
                toast.success("Image uploaded");
            } catch (err) {
                const detail = axios.isAxiosError(err)
                    ? (err.response?.data as { error?: { message?: string } | string } | undefined)
                    : undefined;
                const message =
                    (typeof detail?.error === "string" ? detail.error : detail?.error?.message) ??
                    (err instanceof Error ? err.message : "unknown error");
                toast.error(`Upload failed — ${message}`);
            } finally {
                setUploading(false);
            }
        },
        [folder, onChange]
    );

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex items-start gap-3">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {uploading ? (
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : value ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote URL, not a static asset
                        <img src={value} alt="" className="size-full object-cover" />
                    ) : (
                        <span className="text-[10px] text-muted-foreground">No image</span>
                    )}
                </div>
                <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => fileRef.current?.click()}
                        >
                            <Upload className="size-3.5" />
                            Upload
                        </Button>
                        {value ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => onChange(null)}
                            >
                                <Trash2 className="size-3.5" />
                                Remove
                            </Button>
                        ) : null}
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(file);
                            e.target.value = "";
                        }}
                    />
                    <Input
                        placeholder="or paste an image URL"
                        value={value ?? ""}
                        onChange={(e) => onChange(e.target.value.trim() || null)}
                        className="text-xs"
                    />
                </div>
            </div>
        </div>
    );
}
