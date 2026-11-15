"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { ImageViewer } from "@/shared/components/ImageViewer";

/**
 * One WhatsApp attachment inside a chat bubble. Links are short-lived signed
 * R2 URLs from /api/messages/thread (the bucket is private); a thread reload
 * hands out fresh ones.
 */
export type MediaInfo = {
    mediaUrl?: string | null;
    downloadUrl?: string | null;
    mediaType?: string | null;
    fileName?: string | null;
    mediaSize?: number | null;
};

function sizeLabel(n: number | null | undefined): string {
    if (!n) return "";
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MessageMedia({ m }: { m: MediaInfo }) {
    const [viewing, setViewing] = useState(false);
    const type = m.mediaType ?? "";
    if (!m.mediaUrl) {
        // A file we could not keep (too large, or storage was off when it came).
        return type ? <div className="text-xs italic opacity-70">Attachment not saved ({type} {sizeLabel(m.mediaSize)})</div> : null;
    }
    if (type.startsWith("image/")) {
        return (
            <div className="relative group inline-block">
                {/* Opens the zoom viewer on the page — no new tab, no download. */}
                <button type="button" onClick={() => setViewing(true)} className="block cursor-zoom-in" title="View photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring R2 link; next/image would cache it */}
                    <img src={m.mediaUrl} alt={m.fileName ?? "Photo"} className="max-h-64 max-w-full rounded-md object-contain" loading="lazy" />
                </button>
                {viewing && (
                    <ImageViewer src={m.mediaUrl} alt={m.fileName ?? "Photo"} downloadUrl={m.downloadUrl} fileName={m.fileName} onClose={() => setViewing(false)} />
                )}
                {m.downloadUrl && (
                    <a
                        href={m.downloadUrl}
                        download={m.fileName ?? "image.jpg"}
                        title="Download image"
                        className="absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-80 hover:opacity-100 transition-opacity hover:bg-black/80 shadow"
                    >
                        <Download className="size-4" />
                    </a>
                )}
            </div>
        );
    }
    if (type.startsWith("video/")) {
        return (
            <div className="relative group inline-block">
                <video src={m.mediaUrl} controls preload="metadata" className="max-h-64 max-w-full rounded-md" />
                {m.downloadUrl && (
                    <a
                        href={m.downloadUrl}
                        download={m.fileName ?? "video.mp4"}
                        title="Download video"
                        className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-80 hover:opacity-100 transition-opacity hover:bg-black/80 shadow"
                    >
                        <Download className="size-4" />
                    </a>
                )}
            </div>
        );
    }
    if (type.startsWith("audio/")) {
        return (
            <div className="flex items-center gap-2">
                <audio src={m.mediaUrl} controls preload="none" className="w-60 max-w-full" />
                {m.downloadUrl && (
                    <a
                        href={m.downloadUrl}
                        download={m.fileName ?? "voice-note.ogg"}
                        title="Download audio"
                        className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background/80 text-foreground hover:bg-background shadow-sm"
                    >
                        <Download className="size-3.5" />
                    </a>
                )}
            </div>
        );
    }
    return (
        <a
            href={m.downloadUrl ?? m.mediaUrl}
            download={m.fileName ?? "Document"}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 hover:bg-background"
        >
            <FileText className="size-5 shrink-0" />
            <span className="min-w-0">
                <span className="block truncate font-medium">{m.fileName ?? "Document"}</span>
                <span className="block text-[11px] opacity-70">{[type.split("/").pop()?.toUpperCase(), sizeLabel(m.mediaSize)].filter(Boolean).join(" · ")}</span>
            </span>
            <Download className="ml-auto size-4 shrink-0" />
        </a>
    );
}

/** Meta stores "[unsupported]" for what the Business API cannot pass on —
 *  view-once photos, polls, edited/deleted messages, some stickers. Since
 *  2026-11-16 Meta's own reason follows it: "[unsupported] <reason> (<code>)". */
const UNSUPPORTED_NOTE = "WhatsApp didn't pass this message on (view-once photo, poll, edit, etc.) — see it on the phone, or ask them to resend.";

/** The caption of a media message: the stored body minus its "[image] " tag. */
export function captionOf(body: string, hasMedia: boolean): string {
    const b = body.trim();
    if (b === "[unsupported]") return UNSUPPORTED_NOTE;
    if (b.startsWith("[unsupported] ")) return `${UNSUPPORTED_NOTE} Meta says: ${b.slice("[unsupported] ".length)}`;
    return hasMedia ? body.replace(/^\[[a-z]+\]\s?/, "") : body;
}
