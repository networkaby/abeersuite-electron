"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { withoutAdjust } from "@/shared/lib/cloudinaryImage";
import { isAiSkipped, setAiSkipped } from "@/shared/lib/shop/photoMark";

// Konva touches `window` on import, so the editor only ever loads in the browser.
// Never import anything else from the package statically (not even TABS / TOOLS) —
// that pulls Konva into server rendering, where it wants the native `canvas` module.
const FilerobotImageEditor = dynamic(() => import("react-filerobot-image-editor"), { ssr: false });

/**
 * Full photo editor (Filerobot, MIT, runs in the browser): free crop, rotate,
 * flip, light and colour, filters, text / shapes / blur, resize.
 *
 * Unlike Adjust (a Cloudinary URL transform that never touches the original),
 * Save here bakes the edit into a NEW uploaded image and replaces the gallery
 * slot. The old image stays in Cloudinary, so nothing is lost. Framing set by
 * Adjust is dropped — the editor works on the original pixels.
 */
export default function PhotoEditorDialog({
    url,
    onClose,
    onSave,
}: {
    url: string;
    onClose: () => void;
    onSave: (nextUrl: string) => void;
}) {
    const [saving, setSaving] = useState(false);

    const save = async (canvas: HTMLCanvasElement | undefined) => {
        if (!canvas) {
            toast.error("Could not read the edited photo");
            return;
        }
        setSaving(true);
        try {
            const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
            if (!blob) throw new Error("empty canvas");
            const file = new File([blob], "edited.jpg", { type: "image/jpeg" });
            const uploaded = await uploadImageToCloudinary(file, "/api/upload-signature", "shop/products");
            onSave(isAiSkipped(url) ? setAiSkipped(uploaded, true) : uploaded);
            toast.success("Edited photo saved");
            onClose();
        } catch (err) {
            console.error("Edited photo upload failed:", err);
            toast.error("Could not upload the edited photo");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-label="Edit photo">
            {saving ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm">
                    Uploading edited photo…
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                <FilerobotImageEditor
                    source={withoutAdjust(url)}
                    tabsIds={["Adjust", "Finetune", "Filters", "Annotate", "Resize"]}
                    defaultTabId="Adjust"
                    defaultToolId="Crop"
                    Crop={{ ratio: "custom" }}
                    defaultSavedImageType="jpeg"
                    defaultSavedImageQuality={0.92}
                    savingPixelRatio={1}
                    previewPixelRatio={typeof window === "undefined" ? 1 : window.devicePixelRatio}
                    showBackButton={false}
                    avoidChangesNotSavedAlertOnLeave
                    disableSaveIfNoChanges
                    // Skip the library's own name/format dialog — save straight away.
                    onBeforeSave={() => false}
                    onSave={(data) => void save(data.imageCanvas)}
                    onClose={() => onClose()}
                />
            </div>
        </div>
    );
}
