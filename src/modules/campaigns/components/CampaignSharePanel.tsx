"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Copy, Download, ImagePlus, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import {
    CAMPAIGN_MEDIA_TYPES,
    CAMPAIGN_POST_PLACES,
    campaignCaption,
    checkCampaignMedia,
    type CampaignRow,
} from "@/modules/campaigns/lib/campaign";

const placeLabel = (v: string) => CAMPAIGN_POST_PLACES.find((p) => p.value === v)?.label ?? v;

/**
 * WhatsApp Status & Channel for one saved campaign. Meta's API cannot post
 * either, so this prepares what a phone shares: the photo / video (private R2)
 * and the caption. Share opens the phone's share sheet with both; on a PC it
 * downloads the file and copies the caption for WhatsApp Web. Staff then mark
 * where they put it up, which keeps the history.
 */
export default function CampaignSharePanel({
    campaign,
    couponCode,
    onChanged,
}: {
    campaign: CampaignRow;
    couponCode: string | null;
    onChanged: () => void;
}) {
    const [row, setRow] = useState(campaign);
    const [busy, setBusy] = useState<"upload" | "share" | "post" | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const caption = campaignCaption(row, couponCode, COMPANY_DETAILS.sites.shop);
    const isVideo = row.mediaType?.startsWith("video/");

    const changed = (next: CampaignRow) => {
        setRow(next);
        onChanged();
    };

    async function upload(file: File) {
        const bad = checkCampaignMedia(file.type, file.size);
        if (bad) return toast.error(bad);
        setBusy("upload");
        try {
            const { data } = await axios.post<{ key: string; putUrl: string }>(`/api/campaigns/${row.id}/media/upload-url`, {
                name: file.name, type: file.type, size: file.size,
            });
            // Straight to R2 — the signed URL carries the permission.
            const put = await fetch(data.putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
            if (!put.ok) throw new Error(`Upload failed (${put.status})`);
            const saved = await axios.put<CampaignRow>(`/api/campaigns/${row.id}/media`, {
                key: data.key, type: file.type, name: file.name, size: file.size,
            });
            changed(saved.data);
            toast.success("Photo ready for Status and Channel");
        } catch (e) {
            toast.error(extractApiError(e, "Upload failed"));
        } finally {
            setBusy(null);
        }
    }

    async function removeMedia() {
        setBusy("upload");
        try {
            changed((await axios.delete<CampaignRow>(`/api/campaigns/${row.id}/media`)).data);
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

    /** Phone: share sheet with the file + caption. PC (or no file sharing): download + copied caption. */
    async function share() {
        setBusy("share");
        // WhatsApp sometimes drops the text when a photo comes with it — the copy lets staff paste it.
        const copied = await copyCaption();
        try {
            let files: File[] = [];
            if (row.mediaKey) {
                try {
                    // Through our own site: the bucket lets a page show its link, not read it.
                    const res = await fetch(`/api/campaigns/${row.id}/media`);
                    if (!res.ok) throw new Error(String(res.status));
                    const blob = await res.blob();
                    files = [new File([blob], row.mediaName ?? "campaign", { type: row.mediaType ?? blob.type })];
                } catch {
                    /* the file could not be read here; fall back to download below */
                }
            }
            const payload = files.length ? { files, text: caption } : { text: caption };
            if (navigator.share && (!navigator.canShare || navigator.canShare(payload)) && (files.length || !row.mediaKey)) {
                await navigator.share(payload);
                return;
            }
            if (row.mediaDownloadUrl) window.open(row.mediaDownloadUrl, "_blank", "noopener");
            toast.success(copied ? "File downloading, caption copied — paste both into WhatsApp" : "File downloading — copy the caption from here");
        } catch {
            /* the share sheet was closed */
        } finally {
            setBusy(null);
        }
    }

    async function markPosted(place: string) {
        setBusy("post");
        try {
            changed((await axios.post<CampaignRow>(`/api/campaigns/${row.id}/posts`, { place })).data);
            toast.success(`Marked as posted to ${placeLabel(place)}`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="space-y-3 rounded-xl border p-4">
            <div>
                <Label className="text-sm font-semibold">WhatsApp Status &amp; Channel</Label>
                <p className="text-xs text-muted-foreground">
                    WhatsApp does not let software post these, so a phone shares them: add a photo, tap Share, pick WhatsApp, then mark where you put it.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <div className="space-y-2">
                    {row.mediaUrl ? (
                        isVideo ? (
                            <video src={row.mediaUrl} className="aspect-[9/16] w-full rounded-lg bg-black object-contain" controls muted playsInline />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link, not an optimisable asset
                            <img src={row.mediaUrl} alt={row.mediaName ?? "Campaign photo"} className="aspect-[9/16] w-full rounded-lg bg-muted object-cover" />
                        )
                    ) : (
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => fileInput.current?.click()}
                            className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
                        >
                            <ImagePlus className="h-6 w-6" />
                            {busy === "upload" ? "Uploading…" : "Add photo or video"}
                        </button>
                    )}
                    {row.mediaUrl && (
                        <div className="flex gap-1">
                            <Button type="button" size="sm" variant="outline" className="flex-1" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                                {busy === "upload" ? "Uploading…" : "Replace"}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={removeMedia} title="Remove the file">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                    <input
                        ref={fileInput}
                        type="file"
                        accept={CAMPAIGN_MEDIA_TYPES.join(",")}
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void upload(f);
                        }}
                    />
                    <p className="text-[11px] text-muted-foreground">Upright 9:16 looks best. Photo, or MP4 up to 16 MB.</p>
                </div>

                <div className="min-w-0 space-y-3">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Caption</Label>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={async () => ((await copyCaption()) ? toast.success("Caption copied") : toast.error("Could not copy"))}
                            >
                                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                            </Button>
                        </div>
                        <p className="whitespace-pre-line rounded-lg bg-muted/60 p-2 text-[13px] leading-snug">{caption}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={share} disabled={busy !== null}>
                            <Share2 className="mr-1.5 h-4 w-4" /> {busy === "share" ? "Opening…" : "Share"}
                        </Button>
                        {row.mediaDownloadUrl && (
                            <Button type="button" variant="outline" asChild>
                                <a href={row.mediaDownloadUrl} target="_blank" rel="noopener noreferrer">
                                    <Download className="mr-1.5 h-4 w-4" /> Download
                                </a>
                            </Button>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        {CAMPAIGN_POST_PLACES.map((p) => {
                            const last = row.posts.find((x) => x.place === p.value);
                            return (
                                <div key={p.value} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">{p.label}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {last
                                                ? `Posted ${new Date(last.postedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${last.postedByName ? ` by ${last.postedByName}` : ""}`
                                                : p.hint}
                                        </p>
                                    </div>
                                    <Button type="button" size="sm" variant={last ? "ghost" : "outline"} disabled={busy !== null} onClick={() => markPosted(p.value)}>
                                        <Check className="mr-1 h-3.5 w-3.5" /> {last ? "Posted again" : "Mark posted"}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
