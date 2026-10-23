"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { CalendarFold, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { channelOf, pendingChannels, type PostRow } from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";

const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const timeLabel = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

type Group = { key: string; title: string; tone?: "due"; posts: PostRow[] };

/** Due (time passed, something still to share) → each upcoming day → drafts → done. */
function groupPosts(posts: PostRow[], now: number): Group[] {
    const due: PostRow[] = [];
    const drafts: PostRow[] = [];
    const done: PostRow[] = [];
    const days = new Map<string, PostRow[]>();
    for (const p of posts) {
        if (p.status === "DONE") done.push(p);
        else if (!p.scheduledAt) drafts.push(p);
        else if (new Date(p.scheduledAt).getTime() <= now) due.push(p);
        else {
            const k = dayLabel(new Date(p.scheduledAt));
            days.set(k, [...(days.get(k) ?? []), p]);
        }
    }
    return [
        { key: "due", title: "Due now — share these", tone: "due" as const, posts: due },
        ...[...days].map(([k, ps]) => ({ key: k, title: k, posts: ps })),
        { key: "drafts", title: "Drafts — no time set", posts: drafts },
        { key: "done", title: "Done", posts: done },
    ].filter((g) => g.posts.length > 0);
}

/** Every post, in the order staff act on them. Opening one shows its photo and Share buttons. */
export default function PostsQueue() {
    // "Now" is taken when the list arrives, so a re-render never moves a post between groups.
    const [data, setData] = useState<{ posts: PostRow[]; at: number } | null>(null);

    const load = useCallback(() => {
        axios
            .get<{ posts: PostRow[] }>("/api/campaigns/posts")
            .then((r) => setData({ posts: r.data.posts, at: Date.now() }))
            .catch((e) => toast.error(extractApiError(e, "Failed to load posts")));
    }, []);
    useEffect(load, [load]);

    const posts = data?.posts ?? null;
    const groups = data ? groupPosts(data.posts, data.at) : [];

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={CalendarFold}
                    title="Queue & Calendar"
                    description="Every post, soonest first. Open one to share it on each channel and mark it done."
                    actions={
                        <Button asChild>
                            <Link href="/office/campaigns/posts/new">
                                <Plus className="mr-2 h-4 w-4" /> New post
                            </Link>
                        </Button>
                    }
                />

                {posts === null ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : groups.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-14 text-center">
                        <CalendarFold className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="font-medium">No posts yet</p>
                        <p className="text-sm text-muted-foreground">Write one for the WhatsApp Channel and Google Business Profile.</p>
                    </div>
                ) : (
                    groups.map((g) => (
                        <section key={g.key} className="space-y-2">
                            <h2 className={`text-sm font-semibold ${g.tone === "due" ? "text-amber-700 dark:text-amber-400" : ""}`}>{g.title}</h2>
                            <div className={`divide-y rounded-xl border ${g.tone === "due" ? "border-amber-300 dark:border-amber-500/40" : ""}`}>
                                {g.posts.map((p) => {
                                    const waiting = pendingChannels(p);
                                    return (
                                        <Link key={p.id} href={`/office/campaigns/posts/${p.id}`} className="flex items-start gap-4 px-4 py-3 hover:bg-muted/50">
                                            {p.mediaUrl && !p.mediaType?.startsWith("video/") ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                                <img src={p.mediaUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-muted object-cover" />
                                            ) : (
                                                <div className="h-14 w-14 shrink-0 rounded-lg bg-muted" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="line-clamp-2 text-sm">{p.caption}</p>
                                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                    {p.channels.map((c) => {
                                                        const shared = !waiting.includes(c);
                                                        return (
                                                            <span
                                                                key={c}
                                                                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                                                                    shared ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                                                                }`}
                                                            >
                                                                {shared && <Check size={11} />}
                                                                {channelOf(c)?.short ?? c}
                                                            </span>
                                                        );
                                                    })}
                                                    {p.campaign && <span className="text-xs text-muted-foreground">· {p.campaign.name}</span>}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right text-xs text-muted-foreground">
                                                {p.scheduledAt && <div>{timeLabel(new Date(p.scheduledAt))}</div>}
                                                {p.createdByName && <div>{p.createdByName}</div>}
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </section>
                    ))
                )}
            </div>
        </ScrollArea>
    );
}
