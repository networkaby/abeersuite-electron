"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Copy, Download, ExternalLink, ImagePlus, Send, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import {
    GOOGLE_BUSINESS_URL,
    POST_MEDIA_TYPES,
    channelOf,
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
 * Staff then press Done for that channel, which keeps who and when.
 */
export default function PostSharePanel({ post, onChanged }: { post: PostRow; onChanged: (p: PostRow) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
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
    const googleBlock = googleAutoBlock(post);

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

    async function upload(file: File) {
        const bad = checkPostMedia(file.type, file.size);
        if (bad) return toast.error(bad);
        setBusy("upload");
        try {
            const { data } = await axios.post<{ key: string; putUrl: string }>(`/api/campaigns/posts/${post.id}/media/upload-url`, {
                name: file.name, type: file.type, size: file.size,
            });
            // Straight to R2 — the signed URL carries the permission.
            const put = await fetch(data.putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
            if (!put.ok) throw new Error(`Upload failed (${put.status})`);
            const saved = await axios.put<PostRow>(`/api/campaigns/posts/${post.id}/media`, {
                key: data.key, type: file.type, name: file.name, size: file.size,
            });
            onChanged(saved.data);
            toast.success("Photo added");
        } catch (e) {
            toast.error(extractApiError(e, "Upload failed"));
        } finally {
            setBusy(null);
        }
    }

    async function removeMedia() {
        setBusy("upload");
        try {
            onChanged((await axios.delete<PostRow>(`/api/campaigns/posts/${post.id}/media`)).data);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to remove the file"));
        } finally {
            setBusy(null);
        }
    }

    const copyCaption = async () => {
        try {
            await navigator.clipboard.writeText(caption);
            return true;
        } catch {
            return false;
        }
    };

    /** The file as a File, read through our own site (the bucket lets a page show it, not read it). */
    async function mediaFile(): Promise<File | null> {
        if (!post.mediaKey) return null;
        try {
            const res = await fetch(`/api/campaigns/posts/${post.id}/media`);
            if (!res.ok) return null;
            const blob = await res.blob();
            return new File([blob], post.mediaName ?? "post", { type: post.mediaType ?? blob.type });
        } catch {
            return null;
        }
    }

    const download = () => post.mediaDownloadUrl && window.open(post.mediaDownloadUrl, "_blank", "noopener");

    async function share(channel: string) {
        setBusy(`share-${channel}`);
        const copied = await copyCaption();
        try {
            if (channel === "GOOGLE_BUSINESS") {
                download();
                window.open(GOOGLE_BUSINESS_URL, "_blank", "noopener");
                toast.success(copied ? "Caption copied, photo downloading — click Add update on the profile and paste" : "Photo downloading — copy the caption from here");
                return;
            }
            const file = await mediaFile();
            const payload = file ? { files: [file], text: caption } : { text: caption };
            if (navigator.share && (!navigator.canShare || navigator.canShare(payload)) && (file || !post.mediaKey)) {
                await navigator.share(payload);
                return;
            }
            download();
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
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={removeMedia} aria-label="Remove the file">
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
                <p className="text-[11px] text-muted-foreground">Photo, or MP4 up to 16 MB. Upright 9:16 suits Status; 4:3 suits Google.</p>
            </div>

            <div className="min-w-0 space-y-3">
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">What gets pasted</Label>
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
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={download}>
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
                                </div>
                                <div className="flex flex-wrap gap-1.5">
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
