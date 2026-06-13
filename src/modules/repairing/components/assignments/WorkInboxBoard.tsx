"use client";

import { useState } from "react";
import Link from "next/link";
import { Wrench, Clock, CheckCircle2, XCircle, MessageSquare } from "lucide-react";
import WorkActions from "../WorkActions";
import { badgeColor, dotColor } from "@/shared/lib/format/entityColor";

/**
 * One row in the Work Inbox. Deliberately a *presentational* shape: the server
 * maps whatever the current plumbing exposes into this, so the data source can
 * later swap to a real `WorkItem` record without touching this component.
 */
export interface WorkInboxItem {
    id: string;
    ticketId: number;
    successTarget: { id: string; label: string } | null;
    failTarget: { id: string; label: string } | null;
    /** Current worker owns a retry schedule — Unsuccess re-arms it (snooze loop). */
    retryScheduled: boolean;
    workId: string;
    workLabel: string;
    workColor: string;
    successLabel?: string | null;
    failLabel?: string | null;
    status: "todo" | "progress" | "answered";
    coverLabel: string;
    ask: string | null;
    problem: string | null;
    lastNote: string | null;
    lastNoteBy: string | null;
    customer: string;
    phone: string | null;
    device: string;
    assignee: { id: number; name: string } | null;
    /** Finished rows only — the recorded outcome. */
    outcome?: "success" | "unsuccess";
    answer: string | null;
    answeredBy: string | null;
    /** Snoozed = a deferred retry not yet due; lives in the "Waiting" tab. */
    snoozed: boolean;
    /** When the snoozed retry comes due, e.g. "in 2d" (snoozed rows only). */
    wakeLabel: string | null;
    ageLabel: string;
}

const STATUS_PILL: Record<WorkInboxItem["status"], { label: string; cls: string }> = {
    todo: { label: "To do", cls: "bg-muted text-muted-foreground" },
    progress: { label: "In progress", cls: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
    answered: { label: "Done", cls: "bg-muted text-muted-foreground" },
};


export default function WorkInboxBoard({
    items, works, currentUserId,
}: {
    items: WorkInboxItem[];
    works: { id: string; label: string; color: string }[];
    currentUserId: number;
}) {
    const [filter, setFilter] = useState<string>("all");

    // Finished (answered) rows are historical completion stamps — they live ONLY under
    // the Finished tab. Snoozed rows (deferred retries not yet due) live ONLY under the
    // Waiting tab. Both are kept out of the active "all / mine / per-work" queues.
    const matches = (it: WorkInboxItem, f: string) =>
        f === "finished" ? it.status === "answered"
        : it.status === "answered" ? false
        : f === "waiting" ? it.snoozed
        : it.snoozed ? false
        : f === "all" ? true
        : f === "mine" ? it.assignee?.id === currentUserId
        : it.workId === f;

    const shown = items.filter((it) => matches(it, filter));
    const count = (f: string) => items.filter((it) => matches(it, f)).length;
    const openCount = items.filter((it) => it.status !== "answered" && !it.snoozed).length;

    const chip = (id: string, label: string, color?: string) => {
        // Hide empty chips to cut clutter — but always keep "All" and the chip you're
        // currently viewing (so an empty active filter doesn't vanish under you).
        if (id !== "all" && filter !== id && count(id) === 0) return null;
        const d = color ? dotColor(color) : null;
        return (
            <button
                key={id}
                onClick={() => setFilter(id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    filter === id
                        ? "border-foreground/40 bg-muted font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
            >
                {d && <span className={`h-1.5 w-1.5 rounded-full ${d.className}`} style={d.style} aria-hidden />}
                {label}
                <span className="text-muted-foreground/70">{count(id)}</span>
            </button>
        );
    };

    return (
        <div>
            <div className="mb-4 flex items-center gap-3">
                <Wrench size={24} className="text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Work inbox</h1>
                    <p className="text-sm text-muted-foreground">{openCount} things to do · longest-waiting first</p>
                </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
                {chip("all", "All")}
                {chip("mine", "Mine")}
                {works.map((w) => chip(w.id, w.label, w.color))}
                {chip("waiting", "Waiting")}
                {chip("finished", "Finished")}
            </div>

            <div className="space-y-1.5">
                {shown.map((it) => {
                    const pill = STATUS_PILL[it.status];
                    const mine = it.assignee?.id === currentUserId;
                    const answered = it.status === "answered";
                    const snoozed = it.snoozed;
                    return (
                        <div key={it.id} className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
                            <div className="flex items-center gap-2 text-xs">
                                {snoozed ? (
                                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                        <Clock size={11} />Waiting{it.wakeLabel ? ` · ${it.wakeLabel}` : ""}
                                    </span>
                                ) : (
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${pill.cls}`}>{pill.label}</span>
                                )}
                                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${badgeColor(it.workColor).className}`} style={badgeColor(it.workColor).style}>
                                    {it.workLabel}
                                </span>
                                <Link href={`/office/repairing/tickets/${it.ticketId}`} className="shrink-0 text-sm font-semibold hover:underline">
                                    #{it.ticketId}
                                </Link>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                    {it.customer}<span className="mx-1">·</span>{it.device}
                                    {it.phone && <><span className="mx-1">·</span>{it.phone}</>}
                                </span>
                                <span className="ml-auto flex shrink-0 items-center gap-2">
                                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock size={12} />{it.ageLabel}</span>
                                    <Link href={`/office/repairing/tickets/${it.ticketId}`} className="text-primary hover:underline">Open</Link>
                                </span>
                            </div>

                            <div className="mt-1 flex items-center gap-2">
                                {it.coverLabel && (
                                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{it.coverLabel}</span>
                                )}
                                {answered ? (
                                    <span className={`flex min-w-0 flex-1 items-center gap-1 text-xs ${it.outcome === "unsuccess" ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"}`}>
                                        {it.outcome === "unsuccess" ? <XCircle size={12} className="shrink-0" /> : <CheckCircle2 size={12} className="shrink-0" />}
                                        <span className="truncate">
                                            <span className="font-medium">{it.outcome === "unsuccess" ? "Unsuccess" : "Success"}</span>
                                            {it.answeredBy && <span className="text-muted-foreground"> · {it.answeredBy}</span>}
                                            {it.answer && <> — {it.answer}</>}
                                        </span>
                                    </span>
                                ) : (
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        {it.ask && <span className="truncate text-sm font-medium text-foreground">{it.ask}</span>}
                                        {it.lastNote && (
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <MessageSquare size={11} className="shrink-0" />
                                                <span className="truncate">{it.lastNoteBy ? `${it.lastNoteBy}: ` : ""}{it.lastNote}</span>
                                            </span>
                                        )}
                                        {it.problem && <span className="truncate text-xs text-muted-foreground/80">Issue: {it.problem}</span>}
                                        {!it.ask && !it.lastNote && !it.problem && (
                                            <span className="text-xs italic text-muted-foreground/60">No context yet</span>
                                        )}
                                    </span>
                                )}
                                <span className="ml-auto flex shrink-0 items-center gap-2">
                                    {it.assignee && (
                                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                                                {it.assignee.name.slice(0, 2).toUpperCase()}
                                            </span>
                                            <span className="max-w-[90px] truncate">
                                                {mine ? "You" : it.assignee.name}{it.status === "progress" && " · working…"}
                                            </span>
                                        </span>
                                    )}
                                    {!answered && !snoozed && (
                                        <WorkActions
                                            ticketId={it.ticketId}
                                            workLabel={it.workLabel}
                                            successLabel={it.successLabel}
                                            failLabel={it.failLabel}
                                            successTarget={it.successTarget}
                                            failTarget={it.failTarget}
                                            retryScheduled={it.retryScheduled}
                                            isOwned={it.status !== "todo"}
                                            isOwnerMe={mine}
                                        />
                                    )}
                                </span>
                            </div>
                        </div>
                    );
                })}

                {shown.length === 0 && (
                    <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                        Nothing here right now.
                    </div>
                )}
            </div>
        </div>
    );
}
