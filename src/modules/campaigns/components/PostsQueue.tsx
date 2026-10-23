"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { CalendarFold, Check, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { POST_CHANNELS, channelOf, pendingChannels, type PostRow } from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";
import PostsCalendar, { postTime, weekStart } from "./PostsCalendar";

type View = "calendar" | "list";
type Tab = "queue" | "drafts" | "sent";

const VIEW_KEY = "campaigns.posts.view";
const readView = (): View => {
    try {
        return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "calendar";
    } catch {
        return "calendar";
    }
};

const DAY_MS = 864e5;
const timeLabel = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayHeading = (d: Date, now: number) => {
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startOfDay(now)) / DAY_MS);
    const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
    return days === 0 ? `Today, ${date}` : days === 1 ? `Tomorrow, ${date}` : days === -1 ? `Yesterday, ${date}` : d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
};
const startOfDay = (now: number) => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Queue = has a time and still something to share; Drafts = no time; Sent = done. */
function tabOf(p: PostRow): Tab {
    if (p.status === "DONE") return "sent";
    return p.scheduledAt ? "queue" : "drafts";
}

function ChannelChips({ post }: { post: PostRow }) {
    const waiting = pendingChannels(post);
    return (
        <span className="flex flex-wrap gap-1.5">
            {post.channels.map((c) => {
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
        </span>
    );
}

/**
 * Every post — as a week time table (past and future in their hour slots) or as
 * a list in Buffer's Queue / Drafts / Sent tabs. Opening one shows its photo and
 * the Share / Done buttons.
 */
export default function PostsQueue() {
    // "Now" is taken when the list arrives, so a re-render never moves a post.
    const [data, setData] = useState<{ posts: PostRow[]; at: number } | null>(null);
    const [view, setView] = useState<View>("calendar");
    const [tab, setTab] = useState<Tab>("queue");
    const [week, setWeek] = useState<Date | null>(null);
    const [channel, setChannel] = useState<string | null>(null);
    const viewRead = useRef(false);

    const load = useCallback(() => {
        axios
            .get<{ posts: PostRow[] }>("/api/campaigns/posts")
            .then((r) => {
                const at = Date.now();
                // First arrival: also take the view this PC last used (localStorage is client-only).
                if (!viewRead.current) {
                    viewRead.current = true;
                    setView(readView());
                }
                setData({ posts: r.data.posts, at });
                setWeek((w) => w ?? weekStart(new Date(at)));
            })
            .catch((e) => toast.error(extractApiError(e, "Failed to load posts")));
    }, []);
    useEffect(load, [load]);

    const pickView = (v: View) => {
        setView(v);
        try {
            localStorage.setItem(VIEW_KEY, v);
        } catch {
            /* private window — the choice just isn't remembered */
        }
    };

    const now = data?.at ?? 0;
    const posts = (data?.posts ?? []).filter((p) => !channel || p.channels.includes(channel));
    const undated = posts.filter((p) => !postTime(p));
    const weekEnd = week ? new Date(week.getTime() + 6 * DAY_MS) : null;
    const shiftWeek = (n: number) => week && setWeek(new Date(week.getFullYear(), week.getMonth(), week.getDate() + n * 7));

    const listed = posts
        .filter((p) => tabOf(p) === tab)
        .sort((a, b) => {
            const ta = postTime(a)?.getTime() ?? 0;
            const tb = postTime(b)?.getTime() ?? 0;
            return tab === "sent" ? tb - ta : ta - tb;
        });
    const byDay = new Map<string, PostRow[]>();
    for (const p of listed) {
        const t = postTime(p);
        const k = t ? dayHeading(t, now) : "No date";
        byDay.set(k, [...(byDay.get(k) ?? []), p]);
    }
    const count = (t: Tab) => posts.filter((p) => tabOf(p) === t).length;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-6xl space-y-4 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={CalendarFold}
                    title="Queue & Calendar"
                    description="Past and coming posts in their time slots. Open one to share it on each channel and mark it done."
                    actions={
                        <>
                            <div className="flex rounded-lg border p-0.5">
                                <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => pickView("list")}>
                                    <List className="mr-1.5 h-4 w-4" /> List
                                </Button>
                                <Button size="sm" variant={view === "calendar" ? "secondary" : "ghost"} onClick={() => pickView("calendar")}>
                                    <CalendarFold className="mr-1.5 h-4 w-4" /> Calendar
                                </Button>
                            </div>
                            <Button asChild>
                                <Link href="/office/campaigns/posts/new">
                                    <Plus className="mr-2 h-4 w-4" /> New post
                                </Link>
                            </Button>
                        </>
                    }
                />

                <div className="flex flex-wrap items-center gap-2">
                    {view === "calendar" ? (
                        <div className="flex items-center gap-1.5">
                            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => shiftWeek(-1)} aria-label="Previous week">
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => shiftWeek(1)} aria-label="Next week">
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <span className="px-1 text-sm font-medium">
                                {week && weekEnd
                                    ? `${week.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                                    : "…"}
                            </span>
                            <Button size="sm" variant="outline" onClick={() => data && setWeek(weekStart(new Date(data.at)))}>
                                Today
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-1 border-b">
                            {(["queue", "drafts", "sent"] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTab(t)}
                                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm capitalize ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
                                >
                                    {t} <span className="ml-1 rounded bg-muted px-1.5 text-xs">{count(t)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="ml-auto flex flex-wrap gap-1">
                        {[{ value: null, short: "All channels" }, ...POST_CHANNELS.filter((c) => c.ready)].map((c) => (
                            <button
                                key={c.value ?? "all"}
                                type="button"
                                onClick={() => setChannel(c.value)}
                                className={`rounded-md border px-2 py-1 text-xs ${channel === c.value ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}
                            >
                                {c.short}
                            </button>
                        ))}
                    </div>
                </div>

                {data === null || !week ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : view === "calendar" ? (
                    <>
                        {undated.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">No date:</span>
                                {undated.map((p) => (
                                    <Link
                                        key={p.id}
                                        href={`/office/campaigns/posts/${p.id}`}
                                        className="max-w-60 truncate rounded-md bg-violet-100 px-2 py-1 text-violet-900 hover:opacity-80 dark:bg-violet-500/15 dark:text-violet-200"
                                    >
                                        {p.caption}
                                    </Link>
                                ))}
                            </div>
                        )}
                        <PostsCalendar posts={posts} start={week} now={now} />
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" />Posted</span>
                            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-200" />Time passed, still to share</span>
                            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-200" />Coming</span>
                            <span><span className="mr-1 inline-block h-0.5 w-3 bg-red-500 align-middle" />Now</span>
                        </div>
                    </>
                ) : listed.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-14 text-center">
                        <CalendarFold className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="font-medium">{tab === "queue" ? "Nothing scheduled" : tab === "drafts" ? "No drafts" : "Nothing posted yet"}</p>
                        <p className="text-sm text-muted-foreground">Write one for the WhatsApp Channel and Google Business Profile.</p>
                    </div>
                ) : (
                    [...byDay].map(([day, ps]) => (
                        <section key={day} className="space-y-2">
                            <h2 className="text-sm font-semibold">{day}</h2>
                            <div className="divide-y rounded-xl border">
                                {ps.map((p) => {
                                    const t = postTime(p);
                                    const late = p.status !== "DONE" && t && t.getTime() <= now;
                                    return (
                                        <Link key={p.id} href={`/office/campaigns/posts/${p.id}`} className="flex items-start gap-4 px-4 py-3 hover:bg-muted/50">
                                            <div className={`w-16 shrink-0 pt-0.5 text-xs ${late ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                                                {t ? timeLabel(t) : "—"}
                                            </div>
                                            {p.mediaUrl && !p.mediaType?.startsWith("video/") ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                                <img src={p.mediaUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-cover" />
                                            ) : (
                                                <div className="h-12 w-12 shrink-0 rounded-lg bg-muted" />
                                            )}
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <p className="line-clamp-2 text-sm">{p.caption}</p>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <ChannelChips post={p} />
                                                    {p.campaign && <span className="text-xs text-muted-foreground">· {p.campaign.name}</span>}
                                                </div>
                                            </div>
                                            {p.createdByName && <div className="shrink-0 text-xs text-muted-foreground">{p.createdByName}</div>}
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
