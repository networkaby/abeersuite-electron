"use client";

import { AlertTriangle, Camera, Pencil } from "lucide-react";
import type { GuideNote, PhotoGuide } from "../lib/photoGuide";

const STAGE: Record<PhotoGuide["stage"], { label: string; cls: string }> = {
    UNPUBLISHED: { label: "Not started", cls: "bg-muted text-muted-foreground" },
    WAITING: { label: "Waiting for AI", cls: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
    DRAFT: { label: "Draft", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
    ATTENTION: { label: "Attention", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    READY: { label: "Ready", cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
    PUBLISHED: { label: "Published", cls: "bg-green-500/15 text-green-700 dark:text-green-300" },
};

const TIP = "Take: front, back label (model, MRP), the box, and everything inside the box.";

export function StageBadge({ stage }: { stage: PhotoGuide["stage"] }) {
    const s = STAGE[stage];
    return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

/** Same dot colours as the computer's Open problems list (AiNotesBox). */
const DOT: Record<GuideNote["level"], string> = { stop: "bg-red-600", fix: "bg-amber-500", staff: "bg-blue-600" };

function Notes({ notes }: { notes: GuideNote[] }) {
    return (
        <ol className="mt-1 space-y-1">
            {notes.map((n) => (
                <li key={n.no} className="flex items-start gap-1.5">
                    <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${DOT[n.level]}`} />
                    <span className="w-4 shrink-0 text-muted-foreground">{n.no}</span>
                    <span>{n.text}</span>
                </li>
            ))}
        </ol>
    );
}

/** Stage-aware notes above the photos: a one-line Attention, what to shoot, what to fix on the computer. */
export default function MobilePhotoGuide({ guide }: { guide: PhotoGuide }) {
    const { attention, shoot, other } = guide;
    const when = attention?.at ? new Date(attention.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
    return (
        <div className="space-y-2">
            {attention && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm">
                    <p className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-4" aria-hidden /> Attention
                        {(attention.by || when) && <span className="font-normal text-muted-foreground">— {[attention.by, when].filter(Boolean).join(" · ")}</span>}
                    </p>
                    {attention.lines.map((l) => <p key={l} className="text-amber-800 dark:text-amber-300">{l}</p>)}
                </div>
            )}
            <div className="rounded-lg border border-blue-500/40 px-3 py-2 text-sm">
                <p className="flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-400">
                    <Camera className="size-4" aria-hidden /> Shoot these{shoot.length > 0 && ` (${shoot.length})`}
                </p>
                {shoot.length ? <Notes notes={shoot} /> : <p className="mt-1 text-muted-foreground">{TIP}</p>}
            </div>
            {other.length > 0 && (
                <div className="rounded-lg border px-3 py-2 text-sm">
                    <p className="flex items-center gap-1 font-semibold">
                        <Pencil className="size-4" aria-hidden /> Fix these on the computer ({other.length})
                    </p>
                    <Notes notes={other} />
                </div>
            )}
        </div>
    );
}
