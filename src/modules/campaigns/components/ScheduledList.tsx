"use client";

// Campaigns → Scheduled. Everything that goes out on its own, soonest first, and
// what already went today: the due-reminder run (with the customers it would
// reach — Remove puts one on the Never remind list) and the posts waiting to be
// shared. Read from GET /api/campaigns/scheduled.

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { BellRing, ListTodo, Loader2, Megaphone, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { fmt } from "@/shared/lib/format/moneyInr";
import { channelOf } from "@/modules/campaigns/lib/post";
import { ACTION_LABEL, MODE_LABEL, waStatusText, type DuePreview, type ReminderLogRow } from "@/shared/lib/whatsapp/dueReminderTypes";
import CampaignsHeader from "./CampaignsHeader";

type Data = {
    reminders: DuePreview;
    remindersSent: ReminderLogRow[];
    posts: { id: number; caption: string; scheduledAt: string; channels: string[] }[];
    shares: { id: number; channel: string; sharedAt: string; by: string | null; postId: number; caption: string }[];
};

const card = "rounded-lg border bg-card shadow-sm";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const sendTimeLabel = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const channelName = (c: string) => channelOf(c)?.label ?? c;

function reminderStatus(r: DuePreview): string {
    if (!r.enabled) return "Automatic reminders are off.";
    if (r.ranToday) return "Today's run is done — see Sent today.";
    if (r.skipToday) return "Today is a \"Don't send on\" day.";
    return `Goes out at or after ${sendTimeLabel(r.sendTime)} today.`;
}

export default function ScheduledList() {
    const { data, loading, refreshing, reload } = useApiResource<Data>("/api/campaigns/scheduled", { topics: ["settings"] });
    const [removing, setRemoving] = useState<number | null>(null);
    const [removed, setRemoved] = useState<Set<number>>(new Set());

    const remove = async (accountId: number, name: string) => {
        setRemoving(accountId);
        setRemoved((s) => new Set(s).add(accountId)); // optimistic
        try {
            await axios.post("/api/due-reminders/exclude", { accountId });
            toast.success(`${name} will not be reminded. Undo on Due Reminders → Never remind.`);
        } catch (e) {
            setRemoved((s) => { const n = new Set(s); n.delete(accountId); return n; });
            toast.error(extractApiError(e, "Could not remove"));
        } finally {
            setRemoving(null);
        }
    };

    const r = data?.reminders;
    const list = r?.list.filter((p) => !removed.has(p.accountId)) ?? [];
    const sentCount = (data?.remindersSent.length ?? 0) + (data?.shares.length ?? 0);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-3 pb-6">
                <CampaignsHeader
                    icon={ListTodo}
                    title="Scheduled"
                    description="Everything that goes out on its own, and what already went today."
                    actions={
                        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={refreshing}>
                            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
                        </Button>
                    }
                />

                {loading || !data || !r ? (
                    <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : (
                    <>
                        <h2 className="text-sm font-semibold text-muted-foreground">Pending</h2>

                        <section className={card}>
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <BellRing size={16} />
                                    <span className="font-medium">Due reminders</span>
                                    <span className="text-sm text-muted-foreground">{reminderStatus(r)}</span>
                                </div>
                                <Link href="/office/campaigns/due-reminders" className="text-sm text-primary hover:underline">Rules</Link>
                            </div>
                            {list.length === 0 ? (
                                <p className="px-4 py-3 text-sm text-muted-foreground">Nobody to remind.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-left text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Customer</th>
                                            <th className="px-2 py-2 text-right font-medium">Balance</th>
                                            <th className="px-2 py-2 text-right font-medium">Oldest bill</th>
                                            <th className="px-2 py-2 font-medium">Rule</th>
                                            <th className="px-2 py-2 font-medium">Action</th>
                                            <th className="px-4 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {list.map((p) => (
                                            <tr key={p.accountId} className={`border-t ${p.overCap ? "text-muted-foreground" : ""}`}>
                                                <td className="px-4 py-2">{p.name}</td>
                                                <td className="px-2 py-2 text-right tabular-nums">₹{fmt(p.balance)}</td>
                                                <td className="px-2 py-2 text-right tabular-nums">{p.oldestDays} days</td>
                                                <td className="px-2 py-2">{p.rule}</td>
                                                <td className="px-2 py-2">
                                                    {ACTION_LABEL[p.action]}
                                                    {p.overCap && <span className="ml-1 text-xs">(over the daily limit of {r.dailyCap} — waits)</span>}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={removing === p.accountId}
                                                        onClick={() => void remove(p.accountId, p.name)}
                                                        title="Never remind this customer"
                                                    >
                                                        <X size={14} /> Remove
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        <section className={card}>
                            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <Megaphone size={16} />
                                    <span className="font-medium">Posts</span>
                                    <span className="text-sm text-muted-foreground">Shared by hand at their time.</span>
                                </div>
                                <Link href="/office/campaigns/posts" className="text-sm text-primary hover:underline">Calendar</Link>
                            </div>
                            {data.posts.length === 0 ? (
                                <p className="px-4 py-3 text-sm text-muted-foreground">No scheduled posts.</p>
                            ) : (
                                <ul>
                                    {data.posts.map((p) => (
                                        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-sm first:border-t-0">
                                            <span className="w-40 shrink-0 tabular-nums">{when(p.scheduledAt)}</span>
                                            <Link href={`/office/campaigns/posts/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">{p.caption}</Link>
                                            <span className="text-muted-foreground">{p.channels.map(channelName).join(", ")}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Sent today ({sentCount})</h2>

                        <section className={card}>
                            {sentCount === 0 ? (
                                <p className="px-4 py-3 text-sm text-muted-foreground">Nothing sent yet today.</p>
                            ) : (
                                <ul>
                                    {data.remindersSent.map((l) => (
                                        <li key={`r${l.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-sm first:border-t-0">
                                            <span className="w-20 shrink-0 tabular-nums">{time(l.at)}</span>
                                            <BellRing size={14} className="text-muted-foreground" />
                                            <span className="min-w-0 flex-1 truncate">{l.party} · ₹{fmt(l.amount)}</span>
                                            <span className="text-muted-foreground">{ACTION_LABEL[l.action]} · {MODE_LABEL[l.mode]} · {waStatusText(l.waStatus)}</span>
                                        </li>
                                    ))}
                                    {data.shares.map((s) => (
                                        <li key={`s${s.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-sm first:border-t-0">
                                            <span className="w-20 shrink-0 tabular-nums">{time(s.sharedAt)}</span>
                                            <Megaphone size={14} className="text-muted-foreground" />
                                            <Link href={`/office/campaigns/posts/${s.postId}`} className="min-w-0 flex-1 truncate hover:underline">{s.caption}</Link>
                                            <span className="text-muted-foreground">{channelName(s.channel)}{s.by ? ` · ${s.by}` : ""}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
