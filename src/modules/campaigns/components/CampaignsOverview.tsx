"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Radar } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { pendingChannels, type PostRow } from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";

/** Where each part of Campaigns lives — the map of the module, live parts first. */
const AREAS = [
    { title: "Posts", text: "Google, Facebook, Instagram, WhatsApp Channel and Status — write once, share each.", href: "/office/campaigns/posts", live: true },
    { title: "Campaigns", text: "An offer or greeting with a coupon, sent as an app notification.", href: "/office/campaigns", live: true },
    { title: "Broadcast", text: "App, WhatsApp, SMS and email to each customer.", href: "/office/campaigns/broadcast", live: false },
    { title: "Newsletter", text: "Email to subscribers.", href: "/office/campaigns/newsletter", live: false },
    { title: "Automations", text: "Review requests, birthdays, win-back and more.", href: "/office/campaigns/automations", live: false },
    { title: "Segments & Consent", text: "Who gets what, and who said no.", href: "/office/campaigns/segments", live: false },
    { title: "Reports", text: "What each channel brought in.", href: "/office/campaigns/reports", live: false },
    { title: "Channels", text: "Connect Google and Facebook / Instagram.", href: "/office/campaigns/channels", live: true },
];

/** The module's front page: what needs sharing now, what is coming, and the map. */
export default function CampaignsOverview() {
    // "Now" is taken when the list arrives, so re-renders count the same.
    const [data, setData] = useState<{ posts: PostRow[]; at: number } | null>(null);

    useEffect(() => {
        // Without the Posts ticks the counts just stay at 0; the map still shows.
        axios
            .get<{ posts: PostRow[] }>("/api/campaigns/posts")
            .then((r) => setData({ posts: r.data.posts, at: Date.now() }))
            .catch(() => setData({ posts: [], at: Date.now() }));
    }, []);

    const posts = data?.posts ?? null;
    const now = data?.at ?? 0;
    const open = (posts ?? []).filter((p) => p.status !== "DONE");
    const due = open.filter((p) => p.scheduledAt && new Date(p.scheduledAt).getTime() <= now);
    const week = open.filter((p) => p.scheduledAt && new Date(p.scheduledAt).getTime() > now && new Date(p.scheduledAt).getTime() < now + 7 * 864e5);
    const waitingShares = open.reduce((n, p) => n + pendingChannels(p).length, 0);
    const tiles = [
        { label: "Due now", value: due.length, sub: "time passed, still to share", warn: due.length > 0 },
        { label: "Next 7 days", value: week.length, sub: "scheduled posts" },
        { label: "Drafts", value: open.filter((p) => !p.scheduledAt).length, sub: "no time set" },
        { label: "Shares waiting", value: waitingShares, sub: "channel posts not done yet" },
    ];

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                <CampaignsHeader icon={Radar} title="Overview" description="Every mass message from one place — posts, campaigns, broadcasts and email." />

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {tiles.map((t) => (
                        <Link key={t.label} href="/office/campaigns/posts" className="rounded-xl border p-4 hover:bg-muted/50">
                            <p className="text-xs text-muted-foreground">{t.label}</p>
                            <p className={`text-2xl font-semibold ${t.warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{posts === null ? "…" : t.value}</p>
                            <p className="text-xs text-muted-foreground">{t.sub}</p>
                        </Link>
                    ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    {AREAS.map((a) => (
                        <Link key={a.title} href={a.href} className="rounded-xl border p-4 hover:bg-muted/50">
                            <p className="flex items-center gap-2 font-medium">
                                {a.title}
                                {!a.live && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Planned</span>}
                            </p>
                            <p className="text-sm text-muted-foreground">{a.text}</p>
                        </Link>
                    ))}
                </div>
            </div>
        </ScrollArea>
    );
}
