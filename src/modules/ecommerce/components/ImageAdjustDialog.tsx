"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crosshair, RotateCcw, SquarePen } from "lucide-react";
import PhotoEditorDialog from "@/modules/ecommerce/components/PhotoEditorDialog";
import {
    CROP_MODES,
    DEFAULT_ADJUST,
    GRAVITY_MODES,
    IMAGE_FIXES,
    IMAGE_FIX_KEYS,
    IMAGE_ROTATIONS,
    PAD_BACKGROUNDS,
    buildUrl,
    readAdjust,
    withAdjust,
    withoutAdjust,
    type CropMode,
    type GravityMode,
    type ImageAdjust,
    type ImageRotation,
    type PadBackground,
} from "@/shared/lib/cloudinaryImage";

const CROP_LABEL: Record<CropMode, string> = {
    pad: "Pad — no crop, fills gaps with matching background",
    fill: "Fill — crop to fill the frame",
    fit: "Fit — shrink inside the frame",
    thumb: "Thumb — crop in close on the focus point",
};

const GRAVITY_LABEL: Record<GravityMode, string> = {
    auto: "Auto",
    "auto:subject": "Auto — subject",
    face: "Face",
    faces: "All faces",
    center: "Centre",
    north: "Top",
    south: "Bottom",
    east: "Right",
    west: "Left",
};

/**
 * Cloudinary rejects `g_auto*` on `c_pad` (HTTP 400), so only offer the
 * positional options there. `c_fit` takes no gravity at all.
 */
function gravityChoices(crop: CropMode): readonly GravityMode[] {
    if (crop === "pad") return GRAVITY_MODES.filter((g) => !g.startsWith("auto") && !g.startsWith("face"));
    return GRAVITY_MODES;
}

/**
 * Per-image framing control. Every option here is a standard Cloudinary
 * transformation (1 count, CDN-cached), so previewing costs effectively
 * nothing. The chosen framing is written back into the image URL.
 */
export default function ImageAdjustDialog({
    url,
    open,
    onOpenChange,
    onSave,
}: {
    url: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (nextUrl: string) => void;
}) {
    const [adjust, setAdjust] = useState<ImageAdjust>(() => readAdjust(url));
    // Natural size is kept in state (not read off a ref during render) so the
    // focus marker re-positions when the image finishes loading.
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    // The picture being framed — starts as the saved photo, becomes the new upload after
    // "Edit picture". The gallery only changes on Save framing, so Cancel leaves it alone
    // (an edited copy already uploaded simply stays unused in Cloudinary).
    const [original, setOriginal] = useState(() => withoutAdjust(url));
    const [editing, setEditing] = useState(false);
    // The original as turned: a focus point is picked on the picture the crop really sees
    // (rotation comes first). c_limit at 10000 px never resizes, so pixels stay original.
    const turned = adjust.rotate ? buildUrl(withAdjust(original, { ...DEFAULT_ADJUST, rotate: adjust.rotate }), { width: 10000 }) : original;

    const preview = (frame: "card" | "square", width = 480) =>
        buildUrl(withAdjust(original, adjust), { width, frame });
    // Click a preview to see it big (owner, 2026-11-21: "cant see result in zoom").
    const [zoom, setZoom] = useState<"card" | "square" | null>(null);

    /** Click on the original picks the focal point, in original-image pixels. */
    const pickFocal = (e: React.MouseEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const rect = img.getBoundingClientRect();
        const scaleX = img.naturalWidth / rect.width;
        const scaleY = img.naturalHeight / rect.height;
        setAdjust((a) => ({
            ...a,
            // A focal point only means something when the image is being cropped.
            crop: a.crop === "pad" || a.crop === "fit" ? "fill" : a.crop,
            focal: { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY },
        }));
    };

    const marker =
        adjust.focal && natural
            ? {
                left: `${(adjust.focal.x / natural.w) * 100}%`,
                top: `${(adjust.focal.y / natural.h) * 100}%`,
            }
            : null;

    return (
        <>
        {/* The Radix dialog steps aside while the editor is up: its focus trap and
            transformed content would otherwise fight the editor's own full-screen modal. */}
        <Dialog open={open && !editing} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Adjust image</DialogTitle>
                    <DialogDescription>
                        Choose how this photo is framed on the shop. Click the original to set the focus point, or
                        edit the picture itself (free crop, text, blur).
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Original — click to set focus</Label>
                        <div className="relative overflow-hidden rounded-md border bg-muted/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={turned}
                                alt=""
                                onLoad={(e) =>
                                    setNatural({
                                        w: e.currentTarget.naturalWidth,
                                        h: e.currentTarget.naturalHeight,
                                    })
                                }
                                onClick={pickFocal}
                                className="max-h-96 w-full cursor-crosshair object-contain"
                            />
                            {marker ? (
                                <span
                                    className="pointer-events-none absolute -ml-3 -mt-3 rounded-full bg-primary/80 p-1 text-primary-foreground shadow"
                                    style={marker}
                                >
                                    <Crosshair className="size-4" />
                                </span>
                            ) : null}
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <SquarePen className="mr-2 size-3.5" />
                            Edit picture (crop, text, blur…)
                        </Button>
                        {adjust.focal ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAdjust((a) => ({ ...a, focal: null }))}
                            >
                                <RotateCcw className="mr-2 size-3.5" />
                                Clear focus point
                            </Button>
                        ) : null}
                    </div>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Crop</Label>
                            <Select
                                value={adjust.crop}
                                onValueChange={(v) =>
                                    setAdjust((a) => {
                                        const crop = v as CropMode;
                                        const allowed = gravityChoices(crop);
                                        return {
                                            ...a,
                                            crop,
                                            // Keep the select showing a valid option for the new crop.
                                            gravity: allowed.includes(a.gravity) ? a.gravity : allowed[0],
                                            focal: crop === "pad" || crop === "fit" ? null : a.focal,
                                        };
                                    })
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CROP_MODES.map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {CROP_LABEL[c]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Focus</Label>
                            <Select
                                // An untouched photo is pad + auto; pad sends no focus then, so it sits in the centre.
                                value={gravityChoices(adjust.crop).includes(adjust.gravity) ? adjust.gravity : "center"}
                                onValueChange={(v) =>
                                    setAdjust((a) => ({ ...a, gravity: v as GravityMode, focal: null }))
                                }
                                disabled={!!adjust.focal || adjust.crop === "fit"}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {gravityChoices(adjust.crop).map((g) => (
                                        <SelectItem key={g} value={g}>
                                            {GRAVITY_LABEL[g]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {adjust.crop === "fit" ? (
                                <p className="text-xs text-muted-foreground">
                                    Fit never cuts the picture, so there is nothing to focus on.
                                </p>
                            ) : adjust.focal ? (
                                <p className="text-xs text-muted-foreground">
                                    Using your manual focus point — clear it to go back to automatic.
                                </p>
                            ) : adjust.crop === "pad" ? (
                                <p className="text-xs text-muted-foreground">
                                    Pad only positions the picture inside the frame. Choose Fill or Thumb for
                                    automatic subject focus.
                                </p>
                            ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Rotate</Label>
                                <Select
                                    value={String(adjust.rotate ?? 0)}
                                    onValueChange={(v) => setAdjust((a) => ({ ...a, rotate: Number(v) as ImageRotation }))}
                                >
                                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {IMAGE_ROTATIONS.map((d) => (
                                            <SelectItem key={d} value={String(d)}>{d ? `${d}° clockwise` : "As uploaded"}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Pad background</Label>
                                <Select
                                    value={adjust.padBg ?? "auto"}
                                    onValueChange={(v) => setAdjust((a) => ({ ...a, padBg: v as PadBackground }))}
                                    disabled={adjust.crop !== "pad"}
                                >
                                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(PAD_BACKGROUNDS) as PadBackground[]).map((b) => (
                                            <SelectItem key={b} value={b}>{PAD_BACKGROUNDS[b]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Fix the look (free)</Label>
                            {IMAGE_FIX_KEYS.map((f) => (
                                <div key={f} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                        id={`fix-${f}`}
                                        checked={!!adjust.fixes?.includes(f)}
                                        onCheckedChange={(on) =>
                                            setAdjust((a) => {
                                                const rest = (a.fixes ?? []).filter((x) => x !== f);
                                                return { ...a, fixes: on === true ? [...rest, f] : rest };
                                            })
                                        }
                                    />
                                    <label htmlFor={`fix-${f}`}>{IMAGE_FIXES[f]}</label>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-1.5">
                            <Label>How it will look</Label>
                            <div className="flex gap-3">
                                <figure className="space-y-1">
                                    <button type="button" onClick={() => setZoom("card")} title="Click to see it big" className="block cursor-zoom-in">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={preview("card")}
                                            alt=""
                                            className="aspect-4/3 w-52 rounded-md border object-cover"
                                        />
                                    </button>
                                    <figcaption className="text-center text-[11px] text-muted-foreground">
                                        Listing card
                                    </figcaption>
                                </figure>
                                <figure className="space-y-1">
                                    <button type="button" onClick={() => setZoom("square")} title="Click to see it big" className="block cursor-zoom-in">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={preview("square")}
                                            alt=""
                                            className="aspect-square w-40 rounded-md border object-cover"
                                        />
                                    </button>
                                    <figcaption className="text-center text-[11px] text-muted-foreground">
                                        Product page
                                    </figcaption>
                                </figure>
                            </div>
                        </div>
                    </div>
                </div>

                {zoom ? (
                    <button
                        type="button"
                        onClick={() => setZoom(null)}
                        title="Click to close"
                        className="absolute inset-0 z-20 flex cursor-zoom-out flex-col items-center justify-center gap-2 rounded-lg bg-background/95 p-4"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={preview(zoom, 1200)}
                            alt=""
                            className={`max-h-[80vh] max-w-full rounded-md border object-cover ${zoom === "card" ? "aspect-4/3" : "aspect-square"}`}
                        />
                        <span className="text-xs text-muted-foreground">
                            {zoom === "card" ? "Listing card" : "Product page"} — click anywhere to close
                        </span>
                    </button>
                ) : null}
                <DialogFooter className="gap-2 sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => setAdjust(DEFAULT_ADJUST)}>
                        Reset
                    </Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={() => {
                                onSave(withAdjust(original, adjust));
                                onOpenChange(false);
                            }}
                        >
                            Save framing
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        {editing ? (
            <PhotoEditorDialog
                url={original}
                onClose={() => setEditing(false)}
                onSave={(next) => {
                    // A new picture: old framing and focus no longer fit it.
                    setOriginal(withoutAdjust(next));
                    setAdjust(DEFAULT_ADJUST);
                    setNatural(null);
                }}
            />
        ) : null}
        </>
    );
}
