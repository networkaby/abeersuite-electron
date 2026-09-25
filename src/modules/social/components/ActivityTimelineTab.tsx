"use client";

// The tracked activity of one person. Reads for itself when opened, so the
// page does not fetch a timeline nobody looks at (§7).

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimeOnly } from "@/shared/lib/format/formatDate";
import { timeAgo, userProfileHref, type ActivityPeriod, type UserActivity } from "./profileTypes";

const PERIODS: { id: ActivityPeriod; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7 days" },
    { id: "30d", label: "Last 30 days" },
];
const EVENT_TONE: Record<UserActivity["type"], string> = {
    ticket_created: "bg-emerald-100 text-emerald-700 border-emerald-200",
    ticket_updated: "bg-blue-100 text-blue-700 border-blue-200",
    wall_post: "bg-violet-100 text-violet-700 border-violet-200",
    user_joined: "bg-slate-100 text-slate-700 border-slate-200",
    login_untracked: "bg-amber-100 text-amber-700 border-amber-200",
    logout_untracked: "bg-amber-100 text-amber-700 border-amber-200",
};

export default function ActivityTimelineTab({ profileId }: { profileId: number }) {
    const [period, setPeriod] = useState<ActivityPeriod>("today");
    const [items, setItems] = useState<UserActivity[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        Promise.resolve().then(() => { if (alive) setLoading(true); });
        axios.get<{ items: UserActivity[] }>(`/api/users/${profileId}/activity`, { params: { period, limit: 120 } })
            .then(r => { if (alive) setItems(r.data.items); })
            .catch(e => {
                if (!axios.isAxiosError(e) || e.response?.status !== 404) toast.error("Failed to load activity timeline");
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [profileId, period]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                {PERIODS.map((button) => (
                    <Button key={button.id} type="button" size="sm" variant={period === button.id ? "default" : "outline"} onClick={() => setPeriod(button.id)}>
                        {button.label}
                    </Button>
                ))}
            </div>

            {loading ? (
                <p className="text-center text-sm text-muted-foreground py-8">Loading activity timeline…</p>
            ) : items.length === 0 ? (
                <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center space-y-1">
                    <Activity size={28} className="mx-auto text-muted-foreground/65" />
                    <p className="text-sm text-muted-foreground">No tracked activity in this time range.</p>
                </div>
            ) : (
                <div className="rounded-lg border border-border bg-card divide-y divide-border">
                    {items.map((item) => (
                        <div key={item.id} className="px-4 py-3.5">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                                        <span className={`text-[10px] border px-1.5 py-0.5 ${EVENT_TONE[item.type]}`}>{item.type.replaceAll("_", " ")}</span>
                                        <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(item.createdAt)} ({formatTimeOnly(item.createdAt)})</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                                    {item.meta?.ticketId && (
                                        <Link href={`/office/repairing/tickets/${item.meta.ticketId}`} className="text-xs text-primary hover:underline mt-1 inline-block">
                                            Open ticket #{item.meta.ticketId}
                                        </Link>
                                    )}
                                    {item.meta?.wallUserId && item.meta.wallUserId !== profileId && (
                                        <Link href={userProfileHref(item.meta.wallUserId)} className="text-xs text-primary hover:underline mt-1 inline-block">
                                            Open {item.meta.wallUserName ?? "user"} profile
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
