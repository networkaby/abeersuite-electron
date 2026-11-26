"use client";

// Campaigns → Scheduled. Everything that goes out on its own, on every channel,
// soonest first — and what already went today. Pending: scheduled campaigns
// (app notification), the due-reminder run (WhatsApp; Remove puts a customer on
// the Never remind list), cart / payment emails the next run would send, and
// posts waiting to be shared (social). Sent today: one timeline of all of them.
// Read from GET /api/campaigns/scheduled.

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Bell, BellRing, CalendarClock, ListTodo, Loader2, Mail, Megaphone, RefreshCw, Send, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { fmt } from "@/shared/lib/format/moneyInr";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { channelOf } from "@/modules/campaigns/lib/post";
import { ACTION_LABEL, MODE_LABEL, waStatusText, type DuePreview, type ReminderLogRow } from "@/shared/lib/whatsapp/dueReminderTypes";
import CampaignsHeader from "./CampaignsHeader";
import ScheduleTimeline from "./ScheduleTimeline";

type EmailPreview = {
    kind: string;
    label: string;
    enabled: boolean;
    rows: { refId: number; name: string; amountPaise: number | null; since: string }[];
};

type Data = {
    reminders: DuePreview;
    remindersSent: ReminderLogRow[];
    emails: EmailPreview[];
    emailsSent: { id: number; kind: string; label: string; email: string | null; status: string; createdAt: string }[];
    campaigns: { id: number; name: string; title: string; channel: string; status: string; scheduledAt: string | null; sentAt: string | null }[];
    posts: { id: number; caption: string; scheduledAt: string; channels: string[] }[];
    shares: { id: number; channel: string; sharedAt: string; by: string | null; postId: number; caption: string }[];
};

type Filter = "ALL" | "WHATSAPP" | "EMAIL" | "NOTIFICATION" | "SOCIAL";
const FILTERS: { value: Filter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "WHATSAPP", label: "WhatsApp" },
    { value: "EMAIL", label: "Email" },
    { value: "NOTIFICATION", label: "Notification" },
    { value: "SOCIAL", label: "Social" },
];

const card = "rounded-lg border bg-card shadow-sm";
const row = "flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-sm first:border-t-0";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const sendTimeLabel = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const channelName = (c: string) => channelOf(c)?.label ?? c;
const EMAIL_STATUS: Record<string, string> = { sent: "Sent", failed: "Failed", pending: "Sending", queued: "Waiting for office", "not-configured": "Email not set up", "no-email": "No email on file" };

function reminderStatus(r: DuePreview): string {
    if (!r.enabled) return "Automatic reminders are off.";
    if (r.ranToday) return "Today's run is done — see Sent today.";
    if (r.skipToday) return "Today is a \"Don't send on\" day.";
    return `Goes out at or after ${sendTimeLabel(r.sendTime)} today.`;
}

function SectionHead({ icon: Icon, title, note, link }: { icon: LucideIcon; title: string; note: string; link?: { href: string; label: string } }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2">
                <Icon size={16} />
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">{note}</span>
            </div>
            {link && <Link href={link.href} className="text-sm text-primary hover:underline">{link.label}</Link>}
        </div>
    );
}

type SentItem = { key: string; at: string; channel: Filter; icon: LucideIcon; text: React.ReactNode; detail: string };

export default function ScheduledList() {
    const { data, loading, refreshing, reload } = useApiResource<Data>("/api/campaigns/scheduled", { topics: ["settings"] });
    const [removing, setRemoving] = useState<number | null>(null);
    const [removed, setRemoved] = useState<Set<number>>(new Set());
    const [busyCampaign, setBusyCampaign] = useState<number | null>(null);
    const [filter, setFilter] = useState<Filter>("ALL");
    const [view, setView] = useState<"TIMELINE" | "LIST">("TIMELINE");
    const [timelineKey, setTimelineKey] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);

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

    const sendCampaignNow = async (c: Data["campaigns"][number]) => {
        if (!(await confirmAction({ title: `Send "${c.title}" now?`, body: "It goes to every customer with notifications on, at once.", confirmLabel: "Send" }))) return;
        setBusyCampaign(c.id);
        try {
            await axios.post(`/api/campaigns/${c.id}/send`);
            toast.success("Sending now");
            await reload();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to send the campaign"));
        } finally {
            setBusyCampaign(null);
        }
    };

    const cancelCampaign = async (c: Data["campaigns"][number]) => {
        setBusyCampaign(c.id);
        try {
            await axios.post(`/api/campaigns/${c.id}/schedule`, { at: null });
            toast.success(`"${c.name}" taken off the schedule`);
            await reload();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to cancel the schedule"));
        } finally {
            setBusyCampaign(null);
        }
    };

    const show = (f: Filter) => filter === "ALL" || filter === f;
    const r = data?.reminders;
    const list = r?.list.filter((p) => !removed.has(p.accountId)) ?? [];
    // Time has come but not shared everywhere yet — staff also get a push each half hour (runPostReminders).
    const dueNow = (iso: string) => new Date(iso).getTime() <= now;
    const dueCount = data?.posts.filter((p) => dueNow(p.scheduledAt)).length ?? 0;
    const pendingCampaigns = data?.campaigns.filter((c) => c.status === "SCHEDULED") ?? [];

    const sent: SentItem[] = data
        ? [
              ...data.remindersSent.map((l) => ({
                  key: `r${l.id}`, at: l.at, channel: "WHATSAPP" as const, icon: BellRing,
                  text: `${l.party} · ₹${fmt(l.amount)}`,
                  detail: `${ACTION_LABEL[l.action]} · ${MODE_LABEL[l.mode]} · ${waStatusText(l.waStatus)}`,
              })),
              ...data.emailsSent.map((e) => ({
                  key: `e${e.id}`, at: e.createdAt, channel: "EMAIL" as const, icon: Mail,
                  text: `${e.label}${e.email ? ` · ${e.email}` : ""}`,
                  detail: EMAIL_STATUS[e.status] ?? e.status,
              })),
              ...data.campaigns.filter((c) => c.status === "SENT" && c.sentAt).map((c) => ({
                  key: `c${c.id}`, at: c.sentAt!, channel: "NOTIFICATION" as const, icon: Bell,
                  text: <Link href="/office/campaigns" className="hover:underline">{c.title}</Link>,
                  detail: `Campaign · ${c.name}`,
              })),
              ...data.shares.map((s) => ({
                  key: `s${s.id}`, at: s.sharedAt, channel: "SOCIAL" as const, icon: Megaphone,
                  text: <Link href={`/office/campaigns/posts/${s.postId}`} className="hover:underline">{s.caption}</Link>,
                  detail: `${channelName(s.channel)}${s.by ? ` · ${s.by}` : ""}`,
              })),
          ]
              .filter((i) => show(i.channel))
              .sort((a, b) => b.at.localeCompare(a.at))
        : [];

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-3 pb-6">
                <CampaignsHeader
                    icon={ListTodo}
                    title="Scheduled"
                    description="Everything waiting to go out on every channel, and what already went today."
                    actions={
                        <Button variant="outline" size="sm" onClick={() => { void reload(); setTimelineKey((k) => k + 1); }} disabled={refreshing}>
                            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
                        </Button>
                    }
                />

                <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-2 flex rounded-lg border p-0.5">
                        {(["TIMELINE", "LIST"] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setView(v)}
                                className={`rounded-md px-3 py-1 text-sm ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                            >
                                {v === "TIMELINE" ? "Timeline" : "List"}
                            </button>
                        ))}
                    </div>
                    {FILTERS.map((f) => (
                        <button
                            key={f.value}
                            type="button"
                            onClick={() => setFilter(f.value)}
                            className={`rounded-full border px-3 py-1 text-sm ${filter === f.value ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {view === "TIMELINE" ? (
                    <ScheduleTimeline show={show} reloadKey={timelineKey} />
                ) : loading || !data || !r ? (
                    <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : (
                    <>
                        {dueCount > 0 && show("SOCIAL") && (
                            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                                <Megaphone size={16} />
                                {dueCount === 1 ? "1 post is due — share it now." : `${dueCount} posts are due — share them now.`}
                            </div>
                        )}

                        <h2 className="text-sm font-semibold text-muted-foreground">Pending</h2>

                        {show("NOTIFICATION") && (
                            <section className={card}>
                                <SectionHead icon={Bell} title="Campaigns" note="App notifications, sent at their time." link={{ href: "/office/campaigns", label: "Campaigns" }} />
                                {pendingCampaigns.length === 0 ? (
                                    <p className="px-4 py-3 text-sm text-muted-foreground">No scheduled campaigns.</p>
                                ) : (
                                    <ul>
                                        {pendingCampaigns.map((c) => (
                                            <li key={c.id} className={row}>
                                                <span className="flex w-48 shrink-0 items-center gap-1 whitespace-nowrap tabular-nums"><CalendarClock size={14} className="text-muted-foreground" />{when(c.scheduledAt!)}</span>
                                                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{c.title}</span> <span className="text-muted-foreground">· {c.name}</span></span>
                                                <Button variant="ghost" size="sm" disabled={busyCampaign === c.id} onClick={() => void sendCampaignNow(c)}>
                                                    <Send size={14} /> Send now
                                                </Button>
                                                <Button variant="ghost" size="sm" disabled={busyCampaign === c.id} onClick={() => void cancelCampaign(c)}>
                                                    <X size={14} /> Cancel
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )}

                        {show("WHATSAPP") && (
                            <section className={card}>
                                <SectionHead icon={BellRing} title="Due reminders" note={reminderStatus(r)} link={{ href: "/office/campaigns/due-reminders", label: "Rules" }} />
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
                        )}

                        {show("EMAIL") && (
                            <section className={card}>
                                <SectionHead icon={Mail} title="Emails" note="Go out at the next half-hourly run." link={{ href: "/office/settings/email-templates", label: "Templates" }} />
                                {data.emails.map((g) => (
                                    <div key={g.kind} className="border-t py-1 first:border-t-0">
                                        <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                                            {g.label}
                                            {!g.enabled && " — switched off, nothing goes"}
                                        </p>
                                        {g.enabled && g.rows.length === 0 && <p className="px-4 pb-2 text-sm text-muted-foreground">Nobody waiting.</p>}
                                        <ul>
                                            {g.rows.map((e) => (
                                                <li key={e.refId} className="flex flex-wrap items-center gap-x-3 px-4 py-1.5 text-sm">
                                                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                                                    {e.amountPaise != null && <span className="tabular-nums">₹{fmt(e.amountPaise / 100)}</span>}
                                                    <span className="text-muted-foreground">since {when(e.since)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </section>
                        )}

                        {show("SOCIAL") && (
                            <section className={card}>
                                <SectionHead icon={Megaphone} title="Posts" note="Shared by hand at their time — staff get a reminder when one is due." link={{ href: "/office/campaigns/posts", label: "Calendar" }} />
                                {data.posts.length === 0 ? (
                                    <p className="px-4 py-3 text-sm text-muted-foreground">No scheduled posts.</p>
                                ) : (
                                    <ul>
                                        {data.posts.map((p) => (
                                            <li key={`${p.id}-${p.scheduledAt}`} className={row}>
                                                <span className="w-40 shrink-0 tabular-nums">{when(p.scheduledAt)}</span>
                                                {dueNow(p.scheduledAt) && (
                                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">Due now</span>
                                                )}
                                                <Link href={`/office/campaigns/posts/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">{p.caption}</Link>
                                                <span className="text-muted-foreground">{p.channels.map(channelName).join(", ")}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )}

                        <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Sent today ({sent.length})</h2>

                        <section className={card}>
                            {sent.length === 0 ? (
                                <p className="px-4 py-3 text-sm text-muted-foreground">Nothing sent yet today.</p>
                            ) : (
                                <ul>
                                    {sent.map((i) => (
                                        <li key={i.key} className={row}>
                                            <span className="w-20 shrink-0 tabular-nums">{time(i.at)}</span>
                                            <i.icon size={14} className="text-muted-foreground" />
                                            <span className="min-w-0 flex-1 truncate">{i.text}</span>
                                            <span className="text-muted-foreground">{i.detail}</span>
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
