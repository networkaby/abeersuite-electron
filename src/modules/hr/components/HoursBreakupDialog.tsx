"use client";

// One person's month, hour by hour — the drill-down behind a name in the register.
//
// Owner, 2026-09-22: "we need to know how many time he/she was active, how the
// day is calculated, hour breakup user wise day wise." Three questions, and the
// answer to all three is the same table: a line per day carrying the times-active
// count and the whole working, and a click on any line opening the stretches it
// was added up from.
//
// The point of showing the arithmetic rather than the verdict is that a grade
// nobody can question is a grade nobody can correct. Duty, worked, away, late,
// over or short — the reader sees for themselves why the day came out as it did,
// and can say so if it is wrong.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { monthBounds } from "../lib/attendanceCalendar";
import { totalBreakup, type DayBreakup, type SpanDto } from "../lib/attendanceBreakup";
import type { HoursPayload } from "../lib/attendanceHoursTypes";

const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short", timeZone: "UTC" });

/** Why a stretch finished, in words the reader does not have to decode. */
const ENDED_BY: Record<SpanDto["endedBy"], string> = {
    OPEN:         "still going",
    IDLE:         "left the counter",
    SIGNED_OUT:   "signed out",
    SHIFT_CLOSED: "shift closed",
};

/** A dash rather than a zero: a column of noughts is harder to read than a gap. */
const orDash = (minutes: number) => (minutes > 0 ? formatWorked(minutes) : "—");

/** "HALF_DAY" → "half day". The words are for a reader, not for a database. */
const inWords = (s: string) => s.toLowerCase().replace(/_/g, " ");

export default function HoursBreakupDialog({ userId, userName, year, month, onClose }: {
    userId: number;
    userName: string;
    year: number;
    month: number;
    onClose: () => void;
}) {
    const [y, setY] = useState(year);
    const [m, setM] = useState(month);
    const { from, to } = monthBounds(y, m);
    const { data, loading, error, reload } = useApiResource<HoursPayload>(
        `/api/hr/attendance/hours?userId=${userId}&from=${from}&to=${to}`,
    );
    const [open, setOpen] = useState<string | null>(null);

    const days = useMemo(() => data?.days ?? [], [data]);
    const totals = useMemo(() => totalBreakup(days), [days]);
    const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

    const move = (delta: number) => {
        const d = new Date(Date.UTC(y, m - 1 + delta, 1));
        setY(d.getUTCFullYear()); setM(d.getUTCMonth() + 1); setOpen(null);
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{userName} — hours</DialogTitle>
                    <DialogDescription>
                        Every stretch actually worked. Time away from the machine for longer than the idle
                        limit is not counted, so a forgotten sign-out costs nothing and is not paid either.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between border-b border-border pb-2">
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
                        <span className="min-w-36 text-center text-sm font-medium">{monthName}</span>
                        <Button variant="ghost" size="icon" onClick={() => move(1)} aria-label="Next month"><ChevronRight className="size-4" /></Button>
                    </div>
                    {totals.days > 0 && (
                        <div className="text-xs text-muted-foreground">
                            {totals.days} days measured · active {totals.activeCount} times · worked {formatWorked(totals.worked)}
                        </div>
                    )}
                </div>

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && days.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">Nothing on the register this month.</div>
                )}

                {days.length > 0 && (
                    <ScrollArea className="min-h-0 flex-1">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                                <tr className="border-b border-border">
                                    <th className="px-2 py-2 text-left font-medium">Day</th>
                                    <th className="px-2 py-2 text-left font-medium">In</th>
                                    <th className="px-2 py-2 text-left font-medium">Out</th>
                                    <th className="px-2 py-2 text-right font-medium" title="How many separate stretches they were active">Times</th>
                                    <th className="px-2 py-2 text-right font-medium">Duty</th>
                                    <th className="px-2 py-2 text-right font-medium">Worked</th>
                                    <th className="px-2 py-2 text-right font-medium" title="Away in the middle of the day, between one stretch and the next">Away</th>
                                    <th className="px-2 py-2 text-right font-medium">Late</th>
                                    <th className="px-2 py-2 text-right font-medium" title="Over the duty owed, or short of it">Over / short</th>
                                    <th className="px-2 py-2 text-left font-medium">Reads as</th>
                                </tr>
                            </thead>
                            <tbody>
                                {days.map((d) => (
                                    <DayRow
                                        key={d.date}
                                        day={d}
                                        open={open === d.date}
                                        onToggle={() => setOpen(open === d.date ? null : d.date)}
                                    />
                                ))}
                            </tbody>
                            {totals.days > 0 && (
                                <tfoot className="border-t-2 border-border text-xs font-medium">
                                    <tr>
                                        <td className="px-2 py-2" colSpan={3}>{totals.days} days measured</td>
                                        <td className="px-2 py-2 text-right">{totals.activeCount}</td>
                                        <td className="px-2 py-2 text-right">{formatWorked(totals.duty)}</td>
                                        <td className="px-2 py-2 text-right">{formatWorked(totals.worked)}</td>
                                        <td className="px-2 py-2 text-right">{orDash(totals.idle)}</td>
                                        <td className="px-2 py-2 text-right">{totals.lateDays > 0 ? `${orDash(totals.late)} · ${totals.lateDays}d` : "—"}</td>
                                        <td className="px-2 py-2 text-right">
                                            {totals.overtime > 0 && <span className="text-emerald-600">+{formatWorked(totals.overtime)}</span>}
                                            {totals.overtime > 0 && totals.short > 0 && " / "}
                                            {totals.short > 0 && <span className="text-amber-600">−{formatWorked(totals.short)}</span>}
                                            {totals.overtime === 0 && totals.short === 0 && "—"}
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </ScrollArea>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** One day: the line, and the stretches under it once opened. */
function DayRow({ day, open, onToggle }: { day: DayBreakup; open: boolean; onToggle: () => void }) {
    const first = day.spans[0]?.startedAt ?? null;
    const last = day.spans.length ? day.spans[day.spans.length - 1].endedAt : null;

    // A day with no stretches is not a day with no hours — it is a day from before
    // this was recorded, or one nobody worked. Saying "not tracked" is the only
    // honest thing to put there; a zero would read as an absence.
    if (!day.tracked) {
        return (
            <tr className="border-b border-border/50 text-muted-foreground">
                <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(day.date)}</td>
                <td className="px-2 py-1.5 text-xs italic" colSpan={8}>
                    {day.status ? `${inWords(day.status)} — not tracked in detail` : "not tracked in detail"}
                </td>
                <td className="px-2 py-1.5 text-xs">{day.manual ? "marked by office" : ""}</td>
            </tr>
        );
    }

    return (
        <>
            <tr className="cursor-pointer border-b border-border/50 hover:bg-muted/40" onClick={onToggle}>
                <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                        {open
                            ? <ChevronDown className="size-3.5 text-muted-foreground" />
                            : <ChevronRight className="size-3.5 text-muted-foreground" />}
                        {fmtDay(day.date)}
                    </span>
                </td>
                <td className="px-2 py-1.5">{fmtTime(first)}</td>
                <td className="px-2 py-1.5">{fmtTime(last)}</td>
                <td className="px-2 py-1.5 text-right font-medium">{day.activeCount}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{formatWorked(day.dutyMinutes)}</td>
                <td className="px-2 py-1.5 text-right font-medium">{formatWorked(day.workedMinutes)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{orDash(day.idleMinutes)}</td>
                <td className={`px-2 py-1.5 text-right ${day.lateBy > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{orDash(day.lateBy)}</td>
                <td className="px-2 py-1.5 text-right">
                    {day.overtimeMinutes > 0 ? <span className="text-emerald-600">+{formatWorked(day.overtimeMinutes)}</span>
                        : day.shortMinutes > 0 ? <span className="text-amber-600">−{formatWorked(day.shortMinutes)}</span>
                        : "—"}
                </td>
                <td className="px-2 py-1.5">
                    <span className="font-medium">{inWords(day.status || day.grade)}</span>
                    {/* An override that hides what it overrode is how a dispute becomes
                        unanswerable, so the clock's own answer stays beside it. */}
                    {day.manual && day.status !== day.grade && (
                        <span className="ml-1 text-xs text-muted-foreground">(office; clock said {inWords(day.grade)})</span>
                    )}
                </td>
            </tr>

            {open && (
                <tr className="border-b border-border/50 bg-muted/20">
                    <td colSpan={10} className="px-8 py-2">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                            Active {day.activeCount} {day.activeCount === 1 ? "time" : "times"} on this day
                        </div>
                        <table className="w-full text-xs">
                            <tbody>
                                {day.spans.map((s, i) => (
                                    <tr key={`${s.startedAt}-${i}`} className="text-muted-foreground">
                                        <td className="py-0.5 pr-3">{i + 1}.</td>
                                        <td className="py-0.5 pr-3 whitespace-nowrap">{fmtTime(s.startedAt)} – {fmtTime(s.endedAt)}</td>
                                        <td className="py-0.5 pr-3 font-medium text-foreground">{formatWorked(s.minutes)}</td>
                                        <td className="py-0.5 pr-3">{ENDED_BY[s.endedBy]}</td>
                                        <td className="py-0.5">{s.counterId ? `counter ${s.counterId}` : ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {/* The sum said out loud, because "why is this a half day" is
                            the question this whole screen exists to answer. */}
                        <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                            Worked {formatWorked(day.workedMinutes)} of {formatWorked(day.dutyMinutes)} owed
                            {day.idleMinutes > 0 && <> · away {formatWorked(day.idleMinutes)} in between, not counted</>}
                            {day.lateBy > 0 && <> · late by {formatWorked(day.lateBy)}</>}
                            {" "}→ <span className="font-medium text-foreground">{inWords(day.grade)}</span>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
