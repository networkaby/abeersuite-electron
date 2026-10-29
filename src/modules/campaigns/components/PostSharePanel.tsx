"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Copy, Download, ExternalLink, ImagePlus, Plus, Send, Share2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { putToSignedUrl } from "@/shared/lib/storage/signedUpload";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import {
    GOOGLE_BUSINESS_URL,
    POST_MEDIA_TYPES,
    channelOf,
    channelPost,
    checkPostMedia,
    googleAutoBlock,
    postCaption,
    type PostRow,
} from "@/modules/campaigns/lib/post";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The photo and the "put it up" part of one saved post. Google Business Profile
 * posts itself (Post to Google) once connected on Campaigns → Channels; Share
 * prepares each channel by hand:
 *   • WhatsApp Channel / Status — the phone's share sheet with photo + caption
 *     (caption copied too, since WhatsApp can drop it); on a PC, download + copy.
 *   • Google Business Profile — copies the caption, downloads the photo and
 *     opens the Business Profile, where staff click Add update and paste.
 * Each channel shares its own copy (text and photos, post.ts `channelPost`).
 * Staff then press Done for that channel, which keeps who and when.
 */
export default function PostSharePanel({ post, onChanged }: { post: PostRow; onChanged: (p: PostRow) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const extraInput = useRef<HTMLInputElement>(null);
    const copyOf = (channel: string) => channelPost(post, channel);
    const textOf = (channel: string) => postCaption({ caption: copyOf(channel).caption, link: post.link }, COMPANY_DETAILS.sites.shop);
    const caption = postCaption(post, COMPANY_DETAILS.sites.shop);
    const isVideo = post.mediaType?.startsWith("video/");
    // Is the Google connection ready? Asked once; null while asking or when it fails.
    const [googleReady, setGoogleReady] = useState<boolean | null>(null);
    useEffect(() => {
        if (!post.channels.includes("GOOGLE_BUSINESS")) return;
        axios
            .get<{ ready: boolean }>("/api/campaigns/google")
            .then(({ data }) => setGoogleReady(data.ready))
            .catch(() => setGoogleReady(false));
    }, [post.channels]);
    const googleBlock = googleAutoBlock({ googleType: post.googleType, mediaType: copyOf("GOOGLE_BUSINESS").photos[0]?.type ?? null });

    async function postToGoogle(again: boolean) {
        if (again && !window.confirm("This post is already on Google. Post it there again?")) return;
        setBusy("google");
        try {
            const { data } = await axios.post<{ post: PostRow; url: string | null }>(`/api/campaigns/posts/${post.id}/google`, { again });
            onChanged(data.post);
            toast.success("Posted on Google Business Profile", data.url ? { action: { label: "View", onClick: () => window.open(data.url!, "_blank", "noopener") } } : undefined);
        } catch (e) {
            toast.error(extractApiError(e, "Google did not take the post"));
        } finally {
            setBusy(null);
        }
    }

    async function upload(file: File, extra = false) {
        const bad = checkPostMedia(file.type, file.size);
        if (bad) return toast.error(bad);
        setBusy("upload");
        try {
            const { data } = await axios.post<{ key: string; putUrl: string }>(`/api/campaigns/posts/${post.id}/media/upload-url`, {
                name: file.name, type: file.type, size: file.size,
            });
            // Straight to R2 — the signed URL carries the permission.
            await putToSignedUrl(data.putUrl, file, file.type);
            const saved = await axios.put<PostRow>(`/api/campaigns/posts/${post.id}/media`, {
                key: data.key, type: file.type, name: file.name, size: file.size, extra,
            });
            onChanged(saved.data);
            toast.success("Photo added");
        } catch (e) {
            toast.error(extractApiError(e, "Upload failed"));
        } finally {
            setBusy(null);
        }
    }

    async function removeMedia(key?: string) {
        setBusy("upload");
        try {
            onChanged((await axios.delete<PostRow>(`/api/campaigns/posts/${post.id}/media`, { params: key ? { key } : undefined })).data);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to remove the file"));
        } finally {
            setBusy(null);
        }
    }

    const copyCaption = async (text = caption) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    };

    /** A channel's photos as Files, read through our own site (the bucket lets a page show them, not read them). Null when one fails. */
    async function mediaFiles(channel: string): Promise<File[] | null> {
        try {
            return await Promise.all(
                copyOf(channel).photos.map(async (f) => {
                    const res = await fetch(`/api/campaigns/posts/${post.id}/media?key=${encodeURIComponent(f.key)}`);
                    if (!res.ok) throw new Error(String(res.status));
                    const blob = await res.blob();
                    return new File([blob], f.name, { type: f.type || blob.type });
                }),
            );
        } catch {
            return null;
        }
    }

    const download = (channel?: string) => {
        const keys = channel ? copyOf(channel).photos.map((f) => f.key) : post.mediaKey ? [post.mediaKey] : [];
        for (const k of keys) {
            const url = post.photoLinks?.[k]?.downloadUrl;
            if (url) window.open(url, "_blank", "noopener");
        }
    };

    async function share(channel: string) {
        setBusy(`share-${channel}`);
        const text = textOf(channel);
        const copied = await copyCaption(text);
        try {
            if (channel === "GOOGLE_BUSINESS") {
                download(channel);
                window.open(GOOGLE_BUSINESS_URL, "_blank", "noopener");
                toast.success(copied ? "Caption copied, photo downloading — click Add update on the profile and paste" : "Photo downloading — copy the caption from here");
                return;
            }
            const files = await mediaFiles(channel);
            const payload = files?.length ? { files, text } : { text };
            if (navigator.share && (!navigator.canShare || navigator.canShare(payload)) && files) {
                await navigator.share(payload);
                return;
            }
            download(channel);
            toast.success(copied ? "Photo downloading, caption copied — paste both into WhatsApp" : "Photo downloading — copy the caption from here");
        } catch {
            /* the share sheet was closed */
        } finally {
            setBusy(null);
        }
    }

    async function markDone(channel: string) {
        setBusy(`done-${channel}`);
        try {
            onChanged((await axios.post<PostRow>(`/api/campaigns/posts/${post.id}/shares`, { channel })).data);
            toast.success(`Marked as posted on ${channelOf(channel)?.label ?? channel}`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[160px_1fr]">
            <div className="space-y-2">
                {post.mediaUrl ? (
                    isVideo ? (
                        <video src={post.mediaUrl} className="aspect-[4/5] w-full rounded-lg bg-black object-contain" controls muted playsInline />
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link, not an optimisable asset
                        <img src={post.mediaUrl} alt={post.mediaName ?? "Post photo"} className="aspect-[4/5] w-full rounded-lg bg-muted object-cover" />
                    )
                ) : (
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => fileInput.current?.click()}
                        className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
                    >
                        <ImagePlus className="h-6 w-6" />
                        {busy === "upload" ? "Uploading…" : "Add photo or video"}
                    </button>
                )}
                {post.mediaUrl && (
                    <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" className="flex-1" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                            {busy === "upload" ? "Uploading…" : "Replace"}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={() => removeMedia()} aria-label="Remove the file">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                )}
                <input
                    ref={fileInput}
                    type="file"
                    accept={POST_MEDIA_TYPES.join(",")}
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void upload(f);
                    }}
                />
                <p className="text-[11px] text-muted-foreground">Main photo, or MP4 up to 16 MB. Upright 9:16 suits Status; 4:3 suits Google.</p>
                <div className="space-y-1">
                    <Label className="text-xs">More photos</Label>
                    <div className="flex flex-wrap gap-1.5">
                        {post.extraMedia.map((f) => (
                            <div key={f.key} className="group relative size-12 overflow-hidden rounded-md bg-muted" title={f.name}>
                                {f.type.startsWith("video/") ? (
                                    <span className="flex size-full items-center justify-center text-[10px]">Video</span>
                                ) : (
                                    // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                    <img src={post.photoLinks?.[f.key]?.url ?? ""} alt={f.name} className="size-full object-cover" />
                                )}
                                <button
                                    type="button"
                                    aria-label="Remove this photo"
                                    disabled={busy !== null}
                                    onClick={() => removeMedia(f.key)}
                                    className="absolute top-0 right-0 hidden rounded-bl bg-black/60 p-0.5 text-white group-hover:block"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => extraInput.current?.click()}
                            className="flex size-12 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted/50"
                            aria-label="Add another photo"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>
                    <input
                        ref={extraInput}
                        type="file"
                        accept={POST_MEDIA_TYPES.join(",")}
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void upload(f, true);
                        }}
                    />
                    <p className="text-[11px] text-muted-foreground">For channels that take several or other photos — pick them on each channel above.</p>
                </div>
            </div>

            <div className="min-w-0 space-y-3">
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Main text as pasted</Label>
                        <div className="flex gap-1">
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={async () => ((await copyCaption()) ? toast.success("Caption copied") : toast.error("Could not copy"))}
                            >
                                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                            </Button>
                            {post.mediaDownloadUrl && (
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => download()}>
                                    <Download className="mr-1 h-3.5 w-3.5" /> Photo
                                </Button>
                            )}
                        </div>
                    </div>
                    <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-lg bg-muted/60 p-2 text-[13px] leading-snug">{caption}</p>
                </div>

                <div className="space-y-1.5">
                    {post.channels.map((value) => {
                        const ch = channelOf(value);
                        const last = post.shares.find((s) => s.channel === value);
                        const cp = copyOf(value);
                        return (
                            <div key={value} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-1.5 text-sm font-medium">
                                        {last && <Check className="h-4 w-4 text-emerald-600" />}
                                        {ch?.label ?? value}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {last ? `Posted ${when(last.sharedAt)}${last.sharedByName ? ` by ${last.sharedByName}` : ""}` : ch?.hint}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {cp.custom ? "Own copy" : "Main post"}
                                        {cp.scheduledAt ? ` · ${when(cp.scheduledAt.toISOString())}` : " · any time"}
                                        {` · ${cp.photos.length} photo${cp.photos.length === 1 ? "" : "s"}`}
                                    </p>
                                    {cp.custom && <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line">{cp.caption}</p>}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {cp.custom && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label="Copy this channel's text"
                                            onClick={async () => ((await copyCaption(textOf(value))) ? toast.success("Text copied") : toast.error("Could not copy"))}
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                    {value === "GOOGLE_BUSINESS" && googleReady && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={busy !== null || !!googleBlock}
                                            title={googleBlock ?? "Put it up on the listing now, through Google"}
                                            onClick={() => postToGoogle(!!last)}
                                        >
                                            <Send className="mr-1 h-3.5 w-3.5" /> {busy === "google" ? "Posting…" : last ? "Post again" : "Post to Google"}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={value === "GOOGLE_BUSINESS" && googleReady ? "outline" : "default"}
                                        disabled={busy !== null}
                                        onClick={() => share(value)}
                                    >
                                        {value === "GOOGLE_BUSINESS" ? <ExternalLink className="mr-1 h-3.5 w-3.5" /> : <Share2 className="mr-1 h-3.5 w-3.5" />}
                                        {busy === `share-${value}` ? "Opening…" : "Share"}
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => markDone(value)}>
                                        <Check className="mr-1 h-3.5 w-3.5" /> {last ? "Posted again" : "Done"}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
