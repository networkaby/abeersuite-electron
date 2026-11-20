"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cutoutPhoto } from "@/shared/lib/photoCutout";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { withoutAdjust } from "@/shared/lib/cloudinaryImage";
import { isAiSkipped, setAiSkipped } from "@/shared/lib/shop/photoMark";

/**
 * Clean up = the prep agent's cut-out, run in the browser: product onto white,
 * filling the frame, soft shadow. Preview first; nothing uploads until Save,
 * which stores a NEW image and swaps it into the slot (the original stays in Cloudinary).
 */
export default function PhotoCleanUpDialog({
    url,
    onClose,
    onSave,
}: {
    url: string;
    onClose: () => void;
    onSave: (nextUrl: string) => void;
}) {
    const original = withoutAdjust(url);
    // Boxes / packs / cards: keep white panels from being cut through (agent's --solid).
    const [solid, setSolid] = useState(true);
    // Each answer is tagged with the setting it was made for, so a stale one never shows after a toggle.
    const [done, setDone] = useState<{ solid: boolean; blob?: Blob; preview?: string; error?: string } | null>(null);
    const result = done?.solid === solid && done.blob && done.preview ? { blob: done.blob, preview: done.preview } : null;
    const error = done?.solid === solid ? (done.error ?? null) : null;
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let live = true;
        let preview: string | null = null;
        cutoutPhoto(original, { solid })
            .then((blob) => {
                if (!live) return;
                preview = URL.createObjectURL(blob);
                setDone({ solid, blob, preview });
            })
            .catch((e: unknown) => {
                console.error("Clean up failed:", e);
                if (live) setDone({ solid, error: e instanceof Error ? e.message : "Clean up failed" });
            });
        return () => {
            live = false;
            if (preview) URL.revokeObjectURL(preview);
        };
    }, [original, solid]);

    const save = async () => {
        if (!result) return;
        setSaving(true);
        try {
            const file = new File([result.blob], "clean.jpg", { type: "image/jpeg" });
            const uploaded = await uploadImageToCloudinary(file, "/api/upload-signature", "shop/products");
            onSave(isAiSkipped(url) ? setAiSkipped(uploaded, true) : uploaded);
            toast.success("Cleaned-up photo saved");
            onClose();
        } catch (e) {
            console.error("Clean-up upload failed:", e);
            toast.error("Could not upload the cleaned-up photo");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Clean up photo</DialogTitle>
                    <DialogDescription>
                        Cuts the product out onto white, fills the frame and adds a soft shadow — the same look the
                        prep agent makes. Check the result before saving: a ragged edge or a missing part means keep
                        the original.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-3">
                    <figure className="space-y-1">
                        <figcaption className="text-xs text-muted-foreground">Original</figcaption>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={original} alt="" className="aspect-square w-full rounded-md border bg-muted object-contain" />
                    </figure>
                    <figure className="space-y-1">
                        <figcaption className="text-xs text-muted-foreground">Cleaned up</figcaption>
                        {result ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={result.preview} alt="" className="aspect-square w-full rounded-md border object-contain" />
                        ) : (
                            <div className="flex aspect-square w-full items-center justify-center rounded-md border bg-muted p-4 text-center text-sm text-muted-foreground">
                                {error ?? "Working… the first time downloads the AI model (about 170 MB, kept by the browser after that), so it can take a few minutes. After that a photo takes about 15 seconds."}
                            </div>
                        )}
                    </figure>
                </div>

                <div className="flex items-start gap-2">
                    <Checkbox id="cleanup-solid" checked={solid} onCheckedChange={(v) => setSolid(v === true)} disabled={saving} />
                    <Label htmlFor="cleanup-solid" className="text-sm font-normal leading-snug">
                        Box, pack or card — keep white panels solid.
                        <span className="block text-xs text-muted-foreground">
                            Untick for a product with real gaps (cable coil, ring, frame).
                        </span>
                    </Label>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={!result || saving}>
                        {saving ? "Uploading…" : "Save cleaned-up photo"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
