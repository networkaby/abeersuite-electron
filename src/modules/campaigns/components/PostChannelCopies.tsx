"use client";

import { useState } from "react";
import { AlertTriangle, Crop, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_SPECS, channelOf, postPhotos, ratioFits, type PostChannel, type PostRow } from "@/modules/campaigns/lib/post";

/** A channel's copy as the form holds it: null = follows the main post; `scheduledAt` a datetime-local string. */
export type CopyForm = { caption: string | null; scheduledAt: string | null; photos: string[] | null };

/**
 * One card per ticked channel (owner, 2026-10-29): the same idea written its
 * own way — text (to that channel's limit), time, and which photos (up to its
 * count, with a warning when a photo is not its best shape). Untouched, a
 * channel follows the main post; "Same as main" puts it back. With a saved
 * photo, Fit cuts it to the channel's shape (one channel, or all at once).
 */
export default function PostChannelCopies({
    channels,
    copies,
    onChange,
    main,
    post,
    onFit,
}: {
    channels: string[];
    copies: Record<string, CopyForm>;
    onChange: (channel: string, copy: CopyForm | null) => void;
    main: { caption: string; scheduledAt: string };
    post: PostRow | null;
    /** Cut the main photo to shape — `channels`, or every ticked one. */
    onFit: (channels?: string[]) => Promise<void>;
}) {
    const [fitting, setFitting] = useState<string | null>(null);
    // Each photo's size once its preview loads, for the shape warning.
    const [dims, setDims] = useState<Record<string, [number, number]>>({});
    const photos = post ? postPhotos(post) : [];
    const mainKeys = photos.slice(0, 1).map((f) => f.key);
    const canFit = !!post && !!photos[0]?.type.startsWith("image/");
    const fit = async (id: string, channels?: string[]) => {
        setFitting(id);
        try {
            await onFit(channels);
        } finally {
            setFitting(null);
        }
    };

    if (!channels.length) return null;
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Label className="flex-1">Per channel</Label>
                {canFit && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={fitting !== null} onClick={() => fit("all")}>
                        <Crop className="mr-1 h-3.5 w-3.5" /> {fitting === "all" ? "Fitting…" : "Fit photo for every channel"}
                    </Button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                Each channel follows the main post until you customise it — its own words, time and photos. Fit cuts the main photo to each channel&apos;s best shape.
            </p>
            {channels.map((c) => {
                const spec = CHANNEL_SPECS[c as PostChannel];
                const copy = copies[c] ?? null;
                const text = copy?.caption ?? main.caption;
                const tooLong = text.length > spec.textMax;
                const picked = copy?.photos ?? mainKeys;
                const set = (patch: Partial<CopyForm>) => onChange(c, { ...(copy ?? { caption: null, scheduledAt: null, photos: null }), ...patch });
                const togglePhoto = (key: string) => {
                    const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
                    set({ photos: next.slice(-spec.photosMax) });
                };
                const offShape = picked.filter((k) => dims[k] && !ratioFits(c, ...dims[k]));
                return (
                    <div key={c} className={`space-y-2 rounded-lg border p-3 ${tooLong ? "border-destructive" : ""}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{channelOf(c)?.label ?? c}</span>
                            <span className="text-xs text-muted-foreground">
                                {spec.textMax} chars · {spec.photosMax === 1 ? "1 photo" : `up to ${spec.photosMax} photos`} · best {spec.ratioLabel}
                            </span>
                            <span className="flex-1" />
                            {canFit && (
                                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={fitting !== null} onClick={() => fit(c, [c])}>
                                    <Crop className="mr-1 h-3.5 w-3.5" /> {fitting === c ? "Fitting…" : `Fit ${spec.ratio.join(":")}`}
                                </Button>
                            )}
                            {copy ? (
                                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange(c, null)}>
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Same as main
                                </Button>
                            ) : (
                                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => set({ caption: main.caption })}>
                                    <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Customise
                                </Button>
                            )}
                        </div>

                        {copy ? (
                            <>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>{copy.caption === null ? "Text — same as main" : "Text"}</span>
                                        <span className={tooLong ? "font-medium text-destructive" : ""}>
                                            {text.length}/{spec.textMax}
                                        </span>
                                    </div>
                                    <Textarea rows={4} value={text} onChange={(e) => set({ caption: e.target.value })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground">When — empty follows the main time</span>
                                        <Input type="datetime-local" value={copy.scheduledAt ?? ""} onChange={(e) => set({ scheduledAt: e.target.value || null })} />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">
                                        Photos — {picked.length}/{spec.photosMax} picked{copy.photos === null ? " (the main photo)" : ""}
                                    </span>
                                    {post ? (
                                        photos.length ? (
                                            <div className="flex flex-wrap gap-2">
                                                {photos.map((f) => {
                                                    const on = picked.includes(f.key);
                                                    const link = post.photoLinks?.[f.key]?.url;
                                                    return (
                                                        <button
                                                            key={f.key}
                                                            type="button"
                                                            aria-pressed={on}
                                                            onClick={() => togglePhoto(f.key)}
                                                            className={`relative size-16 overflow-hidden rounded-md border-2 ${on ? "border-primary" : "border-transparent opacity-50"}`}
                                                            title={f.name}
                                                        >
                                                            {link && !f.type.startsWith("video/") ? (
                                                                // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                                                <img
                                                                    src={link}
                                                                    alt={f.name}
                                                                    className="size-full object-cover"
                                                                    onLoad={(e) => {
                                                                        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                                                                        setDims((d) => (d[f.key] ? d : { ...d, [f.key]: [w, h] }));
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span className="flex size-full items-center justify-center bg-muted text-[10px]">Video</span>
                                                            )}
                                                            {on && (
                                                                <span className="absolute top-0.5 left-0.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                                                                    {picked.indexOf(f.key) + 1}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">No photos yet — add them under Photo &amp; share below.</p>
                                        )
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Photos added above can be picked here after saving.</p>
                                    )}
                                    {offShape.length > 0 && (
                                        <p className="flex items-center gap-1 text-xs text-amber-700">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            {offShape.length === 1 ? "A picked photo is" : `${offShape.length} picked photos are`} not {spec.ratioLabel} — it still shares, but may be cropped. Fit makes a copy in shape.
                                        </p>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p className={`text-xs ${tooLong ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                                {tooLong
                                    ? `The main text is ${text.length} characters — too long here. Customise a shorter copy.`
                                    : `Same as main${main.scheduledAt ? "" : ", any time"}.`}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
