"use client";

import { formatHhMmFriendly, todayIso } from "@/shared/lib/format/formatDate";
import { formatWorked, parseHhMm } from "@/shared/lib/hr/dutyTime";
import type { MyDay } from "@/shared/lib/hr/myDay";
import { shopMinute, useNowMinute } from "./useLocalClock";
import styles from "./login.module.css";


const clock = (m: number) => formatHhMmFriendly(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);

type Seg = { from: number; to: number; tone: "work" | "extra" | "away" | "late" | "left" };
/** `end`: the words finish at `at` rather than centre on it — the arrival reads back from the moment he came. */
type Tag = { at: number; row: "top" | "bottom"; text: string; tone?: Seg["tone"] | "now"; end?: boolean };

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

    // The whole day, midnight to midnight (owner, 2026-10-14: *"24h time line,
    // full screen width"*) — the same ruler every day, so a glance compares.
    const pc = (m: number) => (Math.min(1440, Math.max(0, m)) / 1440) * 100;

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
        tags.push({ at: firstIn, row: "top", text: `in ${clock(firstIn)} · ${by}`, tone: firstIn > open ? "late" : "extra", end: true });
    }
    if (lastOut !== null && lastOut > close) {
        tags.push({ at: (close + lastOut) / 2, row: "top", text: `${formatWorked(lastOut - close)} after close`, tone: "extra" });
    } else if (now !== null && now >= open && now < close) {
        tags.push({ at: close, row: "top", text: `closes in ${formatWorked(close - now)}`, tone: "work", end: true });
    } else if (now !== null && now < open && firstIn === null) {
        tags.push({ at: open, row: "top", text: `opens in ${formatWorked(open - now)}`, tone: "work", end: true });
    }
    for (const r of lived) {
        // A sliver is still drawn; only a stretch with room for the words is named.
        if (r.kind === "off" && pc(r.to) - pc(r.from) >= 1.2) {
            tags.push({ at: (r.from + r.to) / 2, row: "bottom", text: `away ${formatWorked(r.to - r.from)}`, tone: "away" });
        }
    }

    // Words never sit on words. The opening, closing and "now" labels hold their
    // places; a tag that would land on one (or on an earlier tag) is dropped —
    // its stretch is still drawn. Width is estimated from the text at ~5.8px a
    // character (11.5px text) on a rail of about 1300px (a 1366 counter screen, edge to edge).
    const half = (text: string) => (text.length * 5.8 / 2 / 1300) * 100 + 0.3;
    const taken: { row: Tag["row"]; at: number; half: number }[] = [
        ...(now !== null ? [{ row: "top" as const, at: pc(now), half: half("Now 12:00 PM") }] : []),
        { row: "bottom", at: pc(open), half: half("Duty starts") },
        { row: "bottom", at: pc(close), half: half("Duty starts") },
    ];
    // A tag that is crowded on its own row tries the other one before it is dropped.
    const fits = (row: Tag["row"], at: number, h: number) => !taken.some((o) => o.row === row && Math.abs(o.at - at) < o.half + h);
    const shown = tags.flatMap((t) => {
        const h = half(t.text), at = t.end ? pc(t.at) - h - 1 : pc(t.at);
        const other: Tag["row"] = t.row === "top" ? "bottom" : "top";
        const row = fits(t.row, at, h) ? t.row : fits(other, at, h) ? other : null;
        if (!row) return [];
        taken.push({ row, at, half: h });
        return [{ ...t, row }];
    });

    return (
        <section className={styles.timeline} aria-label="Today's duty timeline">
            <p className={styles.tilllabel}>Today&apos;s duty</p>
            <div className={styles.tlrail}>
                <div className={styles.tltrack} />
                {Array.from({ length: 25 }, (_, h) => (
                    <div key={h} className={h % 3 ? styles.tlhour : `${styles.tlhour} ${styles.tlhour3}`} style={{ left: `${(h / 24) * 100}%` }}>
                        {h % 3 === 0 && <span>{h % 12 === 0 ? (h === 12 ? "12 PM" : "12 AM") : `${h % 12} ${h < 12 ? "AM" : "PM"}`}</span>}
                    </div>
                ))}
                {segs.filter((s) => s.to > s.from).map((s, i) => (
                    <i key={i} className={`${styles.tlseg} ${styles[`tl_${s.tone}`]}`}
                       style={{ left: `${pc(s.from)}%`, width: `${pc(s.to) - pc(s.from)}%` }} />
                ))}
                {/* Duty start and end: a green and an amber post. */}
                {([[open, "Duty starts", styles.tlopen], [close, "Duty ends", styles.tlclose]] as const).map(([m, word, tone]) => (
                    <div key={word} className={`${styles.tlmark} ${tone}`} style={{ left: `${pc(m)}%` }}>
                        <span><b>{clock(m)}</b>{word}</span>
                    </div>
                ))}
                {shown.map((t, i) => (
                    <span key={i} className={`${styles.tltag} ${t.row === "top" ? styles.tltop : styles.tlbottom} ${t.end ? styles.tlend : ""} ${t.tone ? styles[`tt_${t.tone}`] : ""}`}
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
