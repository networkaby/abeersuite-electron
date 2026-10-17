"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Megaphone, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, type CampaignRow } from "@/modules/campaigns/lib/campaign";
import CampaignEditor from "./CampaignEditor";

const STATUS_TONE: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    READY: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    SENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

const labelOf = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;

/**
 * Campaigns — one message to many customers (a greeting, an offer). Phase 1:
 * write and save; sending arrives with phase 2.
 */
export default function CampaignsClient() {
    const [rows, setRows] = useState<CampaignRow[] | null>(null);
    const [editing, setEditing] = useState<CampaignRow | "new" | null>(null);

    const load = useCallback(() => {
        axios
            .get<CampaignRow[]>("/api/campaigns")
            .then((r) => setRows(r.data))
            .catch((e) => toast.error(extractApiError(e, "Failed to load campaigns")));
    }, []);

    useEffect(load, [load]);
    useRealtimeTopics(["settings"], load);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div
                            className="flex h-11 w-11 items-center justify-center rounded-xl"
                            style={{ background: "color-mix(in oklab, var(--m-campaigns) 18%, var(--background))", color: "var(--m-campaigns)" }}
                        >
                            <Megaphone size={22} />
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold leading-tight">Campaigns</h1>
                            <p className="text-sm text-muted-foreground">
                                A greeting or an offer for many customers at once, as an app notification. A campaign can carry a coupon from Retention.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => setEditing("new")}>
                        <Plus className="mr-2 h-4 w-4" />
                        New campaign
                    </Button>
                </div>

                {rows === null ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-14 text-center">
                        <Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="font-medium">No campaigns yet</p>
                        <p className="text-sm text-muted-foreground">Write a festival greeting or an offer to get started.</p>
                    </div>
                ) : (
                    <div className="divide-y rounded-xl border">
                        {rows.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setEditing(c)}
                                className="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-muted/50"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{c.name}</span>
                                        <Badge variant="secondary" className={STATUS_TONE[c.status]}>
                                            {labelOf(CAMPAIGN_STATUSES, c.status)}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">{labelOf(CAMPAIGN_CHANNELS, c.channel)}</span>
                                        {c.coupon && (
                                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                <Ticket size={12} /> {c.coupon.code ?? c.coupon.name}
                                            </span>
                                        )}
                                    </div>
                                    <p className="truncate text-sm text-muted-foreground">
                                        <span className="text-foreground">{c.title}</span> — {c.body}
                                    </p>
                                </div>
                                <div className="shrink-0 text-right text-xs text-muted-foreground">
                                    <div>{new Date(c.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                                    {c.createdBy && <div>{c.createdBy.name}</div>}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <CampaignEditor
                    campaign={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        load();
                    }}
                />
            )}
        </ScrollArea>
    );
}
