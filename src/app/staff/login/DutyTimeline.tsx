"use client";

import { formatHhMmFriendly, todayIso } from "@/shared/lib/format/formatDate";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";
import { formatWorked, parseHhMm } from "@/shared/lib/hr/dutyTime";
import type { MyDay } from "@/shared/lib/hr/myDay";
import { useNowMinute } from "./useLocalClock";
import styles from "./login.module.css";

/** An instant → minutes past midnight on the shop's clock. */
const shopMinute = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return (get("hour") % 24) * 60 + get("minute");
};

const clock = (m: number) => formatHhMmFriendly(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);

type Seg = { from: number; to: number; tone: "work" | "extra" | "away" | "late" | "left" };
type Tag = { at: number; row: "top" | "bottom"; text: string; tone?: Seg["tone"] | "now"; sub?: string };

/**
 * Today on one line, full width under the cards. Owner, 2026-10-14: *"a proper
 * time line where we can see current time, open time, close time … we will mark
 * away also"* — and *"only its pure time line"*: every figure sits on the bar.
 *
 *   green before opening   came early   (extra duty)
 *   amber stripes          duty had begun and he had not come
 *   blue                   at the counter
 *   red stripes            away — a gap past his idle limit (`lived` off lines)
 *   green after closing    stayed on    (extra duty)
 *   dim                    duty still to come
 *
 * Opening and closing are his own duty hours on today's curve — the ones late
 * and overtime are already judged against. Nothing is computed that the server
 * did not hand over; this only places the instants on a ruler.
 */
export default function DutyTimeline({ day }: { day: MyDay }) {
    const nowMs = useNowMinute();
    const open = parseHhMm(day.dutyStart);
    const close = parseHhMm(day.dutyEnd);
    if (nowMs === null || open === null || close === null || close <= open) return null;

    const isToday = day.date === todayIso();
    const now = isToday ? shopMinute(nowMs) : null;
    const lived = (day.lived ?? []).map((r) => ({
        kind: r.kind,
        from: shopMinute(new Date(r.from).getTime()),
        to:   r.open && now !== null ? now : shopMinute(new Date(r.to).getTime()),
    })).filter((r) => r.to >= r.from);
    const on = lived.filter((r) => r.kind === "on");
    const firstIn = on[0]?.from ?? null;
    const lastOut = on.length ? on[on.length - 1].to : null;

    // The ruler: an hour's margin either side of everything there is to show.
    const lo = Math.floor((Math.min(open, firstIn ?? open, now ?? open) - 30) / 60) * 60;
    const hi = Math.ceil((Math.max(close, lastOut ?? close, now ?? close) + 30) / 60) * 60;
    const pc = (m: number) => ((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo)) * 100;

    const segs: Seg[] = [];
    const end = now ?? close;
    if (end < close) segs.push({ from: Math.max(end, open), to: close, tone: "left" });
    // Duty began before he came — or he has not come at all yet.
    const cameAt = firstIn ?? end;
    if (cameAt > open) segs.push({ from: open, to: Math.min(cameAt, close), tone: "late" });
    for (const r of lived) {
        if (r.kind === "off") { segs.push({ from: r.from, to: r.to, tone: "away" }); continue; }
        if (r.from < open) segs.push({ from: r.from, to: Math.min(r.to, open), tone: "extra" });
        if (r.to > open && r.from < close) segs.push({ from: Math.max(r.from, open), to: Math.min(r.to, close), tone: "work" });
        if (r.to > close) segs.push({ from: Math.max(r.from, close), to: r.to, tone: "extra" });
    }

    const tags: Tag[] = [];
    if (firstIn !== null) {
        const by = firstIn < open ? `${formatWorked(open - firstIn)} early` : firstIn > open ? `${formatWorked(firstIn - open)} late` : "on time";
        tags.push({ at: firstIn, row: "top", text: `in ${clock(firstIn)} · ${by}`, tone: firstIn > open ? "late" : "extra" });
    }
    if (lastOut !== null && lastOut > close) {
        tags.push({ at: (close + lastOut) / 2, row: "top", text: `${formatWorked(lastOut - close)} after close`, tone: "extra" });
    } else if (now !== null && now >= open && now < close) {
        tags.push({ at: close, row: "top", text: `closes in ${formatWorked(close - now)}`, tone: "work" });
    } else if (now !== null && now < open) {
        tags.push({ at: open, row: "top", text: `opens in ${formatWorked(open - now)}`, tone: "work" });
    }
    for (const r of lived) {
        // A sliver is still drawn; only a stretch with room for the words is named.
        if (r.kind === "off" && pc(r.to) - pc(r.from) >= 3) {
            tags.push({ at: (r.from + r.to) / 2, row: "bottom", text: `away ${formatWorked(r.to - r.from)}`, tone: "away" });
        }
    }

    return (
        <section className={styles.timeline} aria-label="Today's duty timeline">
            <p className={styles.tilllabel}>Today&apos;s duty</p>
            <div className={styles.tlrail}>
                <div className={styles.tltrack} />
                {segs.filter((s) => s.to > s.from).map((s, i) => (
                    <i key={i} className={`${styles.tlseg} ${styles[`tl_${s.tone}`]}`}
                       style={{ left: `${pc(s.from)}%`, width: `${pc(s.to) - pc(s.from)}%` }} />
                ))}
                {[[open, "opens"], [close, "closes"]].map(([m, word]) => (
                    <div key={word} className={styles.tlmark} style={{ left: `${pc(m as number)}%` }}>
                        <span><b>{clock(m as number)}</b>{word}</span>
                    </div>
                ))}
                {tags.map((t, i) => (
                    <span key={i} className={`${styles.tltag} ${t.row === "top" ? styles.tltop : styles.tlbottom} ${t.tone ? styles[`tt_${t.tone}`] : ""}`}
                          style={{ left: `${pc(t.at)}%` }}>{t.text}</span>
                ))}
                {now !== null && (
                    <div className={styles.tlnow} style={{ left: `${pc(now)}%` }}>
                        <span>Now {clock(now)}</span>
                    </div>
                )}
            </div>
        </section>
    );
}
