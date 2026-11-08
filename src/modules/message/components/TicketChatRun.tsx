"use client";

import { Bot, MessageCircle } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { MessageMedia, captionOf, type MediaInfo } from "@/modules/crm/components/MessageMedia";
import { formatDateTime } from "@/shared/lib/format";
import { chatLineTime, type ChatRun } from "@/modules/message/lib/ticketChatRuns";

/** A timeline line that may carry a WhatsApp photo / file (see ticketLogMedia). */
type LineLog = { id: number; createdAt: string | Date; author?: unknown; media?: MediaInfo | null };

/** Bot badge for messages the app sent by itself. */
export function AutoMessageIcon({ size = 32 }: { size?: number }) {
    return (
        <span
            className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            style={{ width: size, height: size }}
            title="Sent automatically by AbeerSuite"
        >
            <Bot size={Math.round(size / 2)} />
        </span>
    );
}

/** Header (name · staff reply / Automatic message, WhatsApp · date) + each message with its time. */
export function TicketChatRunBody<L extends LineLog>({ run }: { run: ChatRun<L> }) {
    return (
        <>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className={run.auto ? "font-medium text-muted-foreground" : "font-medium text-foreground"}>
                    {run.auto ? "Automatic message" : run.name}
                    {run.staff && !run.auto && <span className="ml-1.5 font-normal text-muted-foreground">· staff reply</span>}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-[11px] text-green-700 dark:text-green-400">
                    <MessageCircle size={11} /> WhatsApp · {formatDateTime(run.lines[0].log.createdAt).split(",")[0]}
                </span>
            </div>
            <div className="space-y-1">
                {run.lines.map(({ log, text }) => (
                    <div key={log.id}>
                        <div className="flex items-baseline justify-between gap-3">
                            <p className={`whitespace-pre-wrap break-words text-sm ${run.auto ? "text-muted-foreground" : "text-foreground/90"}`}>
                                {log.media ? captionOf(text, true) : text}
                            </p>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={formatDateTime(log.createdAt)}>
                                {chatLineTime(log.createdAt)}
                            </span>
                        </div>
                        {log.media && (
                            <div className="mt-1 w-fit max-w-full [&_img]:max-h-56 [&_video]:max-h-56">
                                <MessageMedia m={log.media} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
}

/**
 * One sender's back-to-back WhatsApp messages as a card. Customer = plain,
 * staff = blue tint, automatic = dashed and grey so people's messages stand out.
 */
export function TicketChatRunCard<L extends LineLog>({ run }: { run: ChatRun<L> }) {
    const avatarUrl = ((run.lines[0].log.author ?? null) as { avatarUrl?: string | null } | null)?.avatarUrl;
    return (
        <div className={`flex gap-3 rounded-lg border p-3.5 text-sm ${run.auto ? "border-dashed bg-muted/40 py-2.5 text-muted-foreground" : run.staff ? "border-primary/30 bg-primary/5" : "bg-background/60"}`}>
            <div className="mt-0.5">
                {run.auto ? <AutoMessageIcon /> : <UserAvatar avatarUrl={avatarUrl} name={run.name} sizePx={32} />}
            </div>
            <div className="min-w-0 flex-1"><TicketChatRunBody run={run} /></div>
        </div>
    );
}
