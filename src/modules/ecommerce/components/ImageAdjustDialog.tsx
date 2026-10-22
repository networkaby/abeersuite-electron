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
import { Crosshair, RotateCcw } from "lucide-react";
import {
    CROP_MODES,
    DEFAULT_ADJUST,
    GRAVITY_MODES,
    IMAGE_FIXES,
    IMAGE_FIX_KEYS,
    buildUrl,
    readAdjust,
    withAdjust,
    withoutAdjust,
    type CropMode,
    type GravityMode,
    type ImageAdjust,
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
    const original = withoutAdjust(url);

    const preview = (frame: "card" | "square") =>
        buildUrl(withAdjust(original, adjust), { width: 480, frame });

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
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Adjust image</DialogTitle>
                    <DialogDescription>
                        Choose how this photo is framed on the shop. Click the original to set the focus point.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Original — click to set focus</Label>
                        <div className="relative overflow-hidden rounded-md border bg-muted/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={original}
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
                                value={adjust.gravity}
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
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview("card")}
                                        alt=""
                                        className="aspect-4/3 w-36 rounded-md border object-cover"
                                    />
                                    <figcaption className="text-center text-[11px] text-muted-foreground">
                                        Listing card
                                    </figcaption>
                                </figure>
                                <figure className="space-y-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview("square")}
                                        alt=""
                                        className="aspect-square w-28 rounded-md border object-cover"
                                    />
                                    <figcaption className="text-center text-[11px] text-muted-foreground">
                                        Product page
                                    </figcaption>
                                </figure>
                            </div>
                        </div>
                    </div>
                </div>

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
    );
}
