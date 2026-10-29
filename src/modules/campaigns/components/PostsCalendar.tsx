"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { channelOf, channelTime, pendingChannels, type PostRow } from "@/modules/campaigns/lib/post";

/** The hours the grid shows — the shop's working day with a margin either side. */
export const CALENDAR_FIRST_HOUR = 7;
export const CALENDAR_LAST_HOUR = 22;

const DAY_MS = 864e5;

/** Sunday 00:00 of the week holding `d`, in this PC's time. */
export function weekStart(d: Date): Date {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - s.getDay());
    return s;
}

/**
 * When a post belongs on the grid: its scheduled time, else (a done post made
 * without one) its first share, else null — it then sits in "No date".
 */
export function postTime(p: PostRow): Date | null {
    if (p.scheduledAt) return new Date(p.scheduledAt);
    const first = p.shares.at(-1);
    return p.status === "DONE" && first ? new Date(first.sharedAt) : null;
}

type Tone = "done" | "missed" | "upcoming";
const TONE: Record<Tone, string> = {
    done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
    missed: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
    upcoming: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200",
};

const toneOf = (p: PostRow, channels: string[], at: Date, now: number): Tone =>
    channels.every((c) => !pendingChannels(p).includes(c)) ? "done" : at.getTime() <= now ? "missed" : "upcoming";

/**
 * Where a post sits on the grid: one place per time — channels sharing a time
 * together, a channel copy with its own time apart. A post with no time sits
 * at its first share once done (postTime), else nowhere.
 */
export function postSlots(p: PostRow): { at: Date; channels: string[] }[] {
    if (!p.scheduledAt) {
        const at = postTime(p);
        return at ? [{ at, channels: p.channels }] : [];
    }
    const byTime = new Map<number, string[]>();
    for (const c of p.channels) {
        const at = channelTime(p, c)!.getTime();
        byTime.set(at, [...(byTime.get(at) ?? []), c]);
    }
    return [...byTime].map(([at, channels]) => ({ at: new Date(at), channels }));
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

/**
 * One week as a time table (owner, 2026-10-23: "the time table for past and
 * future"): days across, hours down. Each post sits in the hour it is (or was)
 * meant for — green done, amber time passed and still to share, violet coming.
 * Past slots are shaded, a line marks now, and an empty future slot starts a
 * new post at that time. Posts before or after the shown hours sit in the
 * first / last row.
 */
export default function PostsCalendar({ posts, start, now }: { posts: PostRow[]; start: Date; now: number }) {
    const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
    const hours = Array.from({ length: CALENDAR_LAST_HOUR - CALENDAR_FIRST_HOUR + 1 }, (_, i) => CALENDAR_FIRST_HOUR + i);
    const today = new Date(now).toDateString();

    // Bucket each dated post into its day + hour row.
    const cells = new Map<string, { post: PostRow; at: Date; channels: string[] }[]>();
    for (const post of posts)
        for (const { at, channels } of postSlots(post)) {
        const day = Math.floor((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - start.getTime()) / DAY_MS);
        if (day < 0 || day > 6) continue;
        const hour = Math.min(Math.max(at.getHours(), CALENDAR_FIRST_HOUR), CALENDAR_LAST_HOUR);
        const key = `${day}:${hour}`;
        cells.set(key, [...(cells.get(key) ?? []), { post, at, channels }]);
        }

    const nowDate = new Date(now);
    return (
        <div className="overflow-x-auto rounded-xl border">
            <div className="grid min-w-[860px]" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
                <div className="border-b" />
                {days.map((d) => {
                    const isToday = d.toDateString() === today;
                    return (
                        <div key={d.toISOString()} className={`border-b border-l px-2 py-2 text-center text-xs ${isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                            {d.toLocaleDateString("en-IN", { weekday: "short" })} {d.getDate()}
                        </div>
                    );
                })}

                {hours.map((h) => (
                    <div key={h} className="contents">
                        <div className="border-t px-1.5 pt-1 text-right text-[11px] text-muted-foreground">{hourLabel(h)}</div>
                        {days.map((d, di) => {
                            const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
                            const slotEnd = slot.getTime() + 36e5;
                            const past = slotEnd <= now;
                            const showsNow = slot.getTime() <= now && now < slotEnd;
                            const items = cells.get(`${di}:${h}`) ?? [];
                            return (
                                <div key={di} className={`group relative min-h-14 border-t border-l p-1 ${past ? "bg-foreground/[0.05]" : ""}`}>
                                    {showsNow && (
                                        <div
                                            className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                                            style={{ top: `${(nowDate.getMinutes() / 60) * 100}%` }}
                                            aria-label="Now"
                                        />
                                    )}
                                    <div className="flex flex-col gap-1">
                                        {items.map(({ post, at, channels }) => {
                                            const waiting = pendingChannels(post);
                                            return (
                                                <Link
                                                    key={`${post.id}-${at.getTime()}`}
                                                    href={`/office/campaigns/posts/${post.id}`}
                                                    className={`block rounded-md px-1.5 py-1 text-[11px] leading-tight hover:opacity-80 ${TONE[toneOf(post, channels, at, now)]}`}
                                                    title={post.caption}
                                                >
                                                    <span className="block truncate font-medium">
                                                        {at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {post.caption}
                                                    </span>
                                                    <span className="flex flex-wrap gap-x-1.5">
                                                        {channels.map((c) => (
                                                            <span key={c} className="inline-flex items-center gap-0.5">
                                                                {!waiting.includes(c) && <Check size={10} />}
                                                                {channelOf(c)?.short ?? c}
                                                            </span>
                                                        ))}
                                                    </span>
                                                </Link>
                                            );
                                        })}
                                        {!past && items.length === 0 && (
                                            <Link
                                                href={`/office/campaigns/posts/new?at=${encodeURIComponent(slot.toISOString())}`}
                                                className="block rounded-md px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100"
                                            >
                                                + New
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
