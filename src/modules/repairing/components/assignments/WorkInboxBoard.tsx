"use client";

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Wrench, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import WorkActions from "../WorkActions";

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
    workId: string;
    workLabel: string;
    workColor: string;
    status: "todo" | "progress" | "answered";
    coverLabel: string;
    ask: string | null;
    customer: string;
    phone: string | null;
    device: string;
    assignee: { id: number; name: string } | null;
    answer: string | null;
    answeredBy: string | null;
    ageLabel: string;
}

const STATUS_PILL: Record<WorkInboxItem["status"], { label: string; cls: string }> = {
    todo: { label: "To do", cls: "bg-muted text-muted-foreground" },
    progress: { label: "In progress", cls: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
    answered: { label: "Answered", cls: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
};

const dotClass = (workColor: string) => workColor.split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted-foreground";

export default function WorkInboxBoard({
    items, works, currentUserId,
}: {
    items: WorkInboxItem[];
    works: { id: string; label: string; color: string }[];
    currentUserId: number;
}) {
    const router = useRouter();
    const [filter, setFilter] = useState<string>("all");
    const [closingId, setClosingId] = useState<string | null>(null);

    const matches = (it: WorkInboxItem, f: string) =>
        f === "all" ? true
        : f === "mine" ? it.assignee?.id === currentUserId
        : f === "finished" ? it.status === "answered"
        : it.workId === f;

    const shown = items.filter((it) => matches(it, filter));
    const count = (f: string) => items.filter((it) => matches(it, f)).length;

    const closeWork = async (it: WorkInboxItem) => {
        setClosingId(it.id);
        try {
            await axios.delete(`/api/tickets/${it.ticketId}/sub-status`);
            toast.success("Closed");
            router.refresh();
        } catch {
            toast.error("Failed to close");
        } finally {
            setClosingId(null);
        }
    };

    const chip = (id: string, label: string, dot?: string) => (
        <button
            key={id}
            onClick={() => setFilter(id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                filter === id
                    ? "border-foreground/40 bg-muted font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
        >
            {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
            {label}
            <span className="text-muted-foreground/70">{count(id)}</span>
        </button>
    );

    return (
        <div>
            <div className="mb-4 flex items-center gap-3">
                <Wrench size={24} className="text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Work inbox</h1>
                    <p className="text-sm text-muted-foreground">{items.length} things to do · longest-waiting first</p>
                </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
                {chip("all", "All")}
                {chip("mine", "Mine")}
                {works.map((w) => chip(w.id, w.label, dotClass(w.color)))}
                {chip("finished", "Finished")}
            </div>

            <div className="space-y-1.5">
                {shown.map((it) => {
                    const pill = STATUS_PILL[it.status];
                    const mine = it.assignee?.id === currentUserId;
                    const answered = it.status === "answered";
                    return (
                        <div key={it.id} className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
                            <div className="flex items-center gap-2 text-xs">
                                <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${pill.cls}`}>{pill.label}</span>
                                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${it.workColor}`}>
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
                                {answered && it.answer ? (
                                    <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-green-700 dark:text-green-300">
                                        <CheckCircle2 size={12} className="shrink-0" />
                                        <span className="truncate"><span className="font-medium">{it.answeredBy ?? "Answered"}:</span> {it.answer}</span>
                                    </span>
                                ) : (
                                    it.ask && <span className="min-w-0 flex-1 truncate text-sm text-foreground">{it.ask}</span>
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
                                    {answered ? (
                                        <Button onClick={() => closeWork(it)} disabled={closingId === it.id} size="sm" variant="outline">
                                            {closingId === it.id ? "Closing…" : "Close"}
                                        </Button>
                                    ) : (
                                        <WorkActions
                                            ticketId={it.ticketId}
                                            workLabel={it.workLabel}
                                            successTarget={it.successTarget}
                                            failTarget={it.failTarget}
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
