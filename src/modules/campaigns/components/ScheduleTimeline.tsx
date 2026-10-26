"use client";

// Campaigns → Scheduled → Timeline. Everything sent and everything due, on every
// channel, in time order, one India day per block: yesterday, today and tomorrow
// by default, with Earlier / Later adding a day either side. A line marks now.
// Read from GET /api/campaigns/timeline.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, ChevronDown, ChevronUp, Loader2, Mail, Megaphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiResource } from "@/shared/hooks/useApiResource";

type Channel = "WHATSAPP" | "EMAIL" | "NOTIFICATION" | "SOCIAL";
type Item = { id: string; at: string; channel: Channel; state: "sent" | "due" | "failed"; title: string; detail: string; href: string | null };
type Data = { from: string; days: number; items: Item[] };

const DAY_MS = 86_400_000;
const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shiftDate = (date: string, days: number) => istDate(new Date(new Date(`${date}T12:00:00+05:30`).getTime() + days * DAY_MS));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const CHANNEL: Record<Channel, { icon: LucideIcon; label: string; tone: string }> = {
    WHATSAPP: { icon: BellRing, label: "WhatsApp", tone: "bg-emerald-500" },
    EMAIL: { icon: Mail, label: "Email", tone: "bg-sky-500" },
    NOTIFICATION: { icon: Bell, label: "Notification", tone: "bg-violet-500" },
    SOCIAL: { icon: Megaphone, label: "Social", tone: "bg-amber-500" },
};
const STATE: Record<Item["state"], { label: string; cls: string }> = {
    sent: { label: "Sent", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    due: { label: "Scheduled", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
    failed: { label: "Failed", cls: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
};

function dayLabel(date: string, today: string): string {
    if (date === today) return "Today";
    if (date === shiftDate(today, -1)) return "Yesterday";
    if (date === shiftDate(today, 1)) return "Tomorrow";
    return new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
}

/** `reloadKey` changes when the page's Refresh is pressed. */
export default function ScheduleTimeline({ show, reloadKey }: { show: (c: Channel) => boolean; reloadKey: number }) {
    const [today, setToday] = useState(() => istDate(new Date()));
    const [now, setNow] = useState(() => Date.now());
    const [from, setFrom] = useState(() => shiftDate(istDate(new Date()), -1));
    const [days, setDays] = useState(3);
    const nowRef = useRef<HTMLDivElement>(null);
    const scrolled = useRef(false);

    useEffect(() => {
        const t = setInterval(() => {
            setNow(Date.now());
            setToday(istDate(new Date()));
        }, 60_000);
        return () => clearInterval(t);
    }, []);

    const { data, loading, reload } = useApiResource<Data>(`/api/campaigns/timeline?from=${from}&days=${days}`, { topics: ["settings"] });
    useEffect(() => {
        if (reloadKey) void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a Refresh press reloads
    }, [reloadKey]);

    // Open on "now" once, not on every refresh — the reader may have scrolled away.
    useEffect(() => {
        if (data && !scrolled.current && nowRef.current) {
            nowRef.current.scrollIntoView({ block: "center" });
            scrolled.current = true;
        }
    }, [data]);

    const dates = Array.from({ length: days }, (_, i) => shiftDate(from, i));
    const items = (data?.items ?? []).filter((i) => show(i.channel));

    return (
        <div className="rounded-lg border bg-card shadow-sm">
            <div className="border-b px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => { setFrom(shiftDate(from, -1)); setDays(Math.min(14, days + 1)); }} disabled={days >= 14}>
                    <ChevronUp size={14} /> Earlier
                </Button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto">
                {loading && !data ? (
                    <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : (
                    dates.map((date) => {
                        const start = new Date(`${date}T00:00:00+05:30`).getTime();
                        const dayItems = items.filter((i) => { const t = new Date(i.at).getTime(); return t >= start && t < start + DAY_MS; });
                        const isToday = date === today;
                        const before = isToday ? dayItems.filter((i) => new Date(i.at).getTime() <= now) : dayItems;
                        const after = isToday ? dayItems.filter((i) => new Date(i.at).getTime() > now) : [];
                        return (
                            <section key={date}>
                                <h3 className={`sticky top-0 z-10 border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold backdrop-blur ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                                    {dayLabel(date, today)} <span className="font-normal">· {dayItems.length || "nothing"}</span>
                                </h3>
                                <ol className="relative ml-[5.5rem] border-l py-2">
                                    {before.map((i) => <Row key={i.id} item={i} />)}
                                    {isToday && (
                                        <div ref={nowRef} className="relative my-1 -ml-px flex items-center">
                                            <span className="absolute -left-[5.25rem] w-16 text-right text-xs font-semibold text-red-600">{time(new Date(now).toISOString())}</span>
                                            <span className="-ml-1.5 h-3 w-3 rounded-full bg-red-600" />
                                            <span className="h-px flex-1 bg-red-600" />
                                            <span className="px-2 text-xs font-semibold text-red-600">Now</span>
                                        </div>
                                    )}
                                    {after.map((i) => <Row key={i.id} item={i} />)}
                                    {!dayItems.length && !isToday && <li className="py-2 pl-4 text-sm text-muted-foreground">Nothing sent or scheduled.</li>}
                                </ol>
                            </section>
                        );
                    })
                )}
            </div>

            <div className="border-t px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setDays(Math.min(14, days + 1))} disabled={days >= 14}>
                    <ChevronDown size={14} /> Later
                </Button>
            </div>
        </div>
    );
}

function Row({ item }: { item: Item }) {
    const ch = CHANNEL[item.channel];
    const st = STATE[item.state];
    const title = item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title;
    return (
        <li className="relative py-1.5 pl-4 text-sm">
            <span className="absolute -left-[5.25rem] top-2 w-16 text-right text-xs tabular-nums text-muted-foreground">{time(item.at)}</span>
            <span className={`absolute -left-[5px] top-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${ch.tone}`} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <ch.icon size={14} className="shrink-0 text-muted-foreground" aria-label={ch.label} />
                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
        </li>
    );
}
