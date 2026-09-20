"use client";

// The attendance register — one month, everyone down the side, a cell per day.
// The till fills in the sign-ins; HR clicks a cell to mark it. A click cycles
// P → ½ → A → L → clear, and a cleared cell reads off the calendar again
// (weekly off, holiday, approved leave, or unmarked).

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import UserAvatar from "@/shared/components/UserAvatar";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, monthBounds, readDay, summarise, weekdayOf } from "../lib/attendanceCalendar";
import type { AttendanceMark, RegisterPayload } from "../lib/attendanceTypes";

const CYCLE: (AttendanceStatus | null)[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", null];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const CELL: Record<AttendanceStatus, string> = {
    PRESENT:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    HALF_DAY:   "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    ABSENT:     "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
    LEAVE:      "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    WEEKLY_OFF: "bg-muted text-muted-foreground",
    HOLIDAY:    "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
};

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

export default function AttendanceRegister({ canEdit }: { canEdit: boolean; selfId: number }) {
    const today = todayIso();
    const [year, setYear] = useState(Number(today.slice(0, 4)));
    const [month, setMonth] = useState(Number(today.slice(5, 7)));
    const { from, to } = monthBounds(year, month);
    const { data, loading, refreshing, error, reload } = useApiResource<RegisterPayload>(`/api/hr/attendance?from=${from}&to=${to}`);
    useRealtimeTopics(["settings"], reload);

    // Optimistic marks laid over the payload, so a click paints at once (AGENTS §7).
    const [overrides, setOverrides] = useState<Record<string, AttendanceMark | null>>({});
    const days = useMemo(() => isoDaysBetween(from, to), [from, to]);
    const holidayDates = useMemo(() => new Set((data?.holidays ?? []).map((h) => h.date)), [data]);
    const people = useMemo(() => (data?.people ?? []).map((p) => {
        const marks = { ...p.marks };
        for (const [k, v] of Object.entries(overrides)) {
            const [uid, iso] = k.split("|");
            if (Number(uid) !== p.id) continue;
            if (v === null) delete marks[iso]; else marks[iso] = v;
        }
        return { ...p, marks };
    }), [data, overrides]);

    const move = (delta: number) => {
        const d = new Date(Date.UTC(year, month - 1 + delta, 1));
        setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1); setOverrides({});
    };

    const mark = async (userId: number, iso: string, current: AttendanceStatus | null) => {
        if (!canEdit || iso > today) return;
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
        const key = `${userId}|${iso}`;
        const before = overrides[key];
        setOverrides((o) => ({ ...o, [key]: next ? { status: next, source: "OFFICE", firstInAt: null, lastOutAt: null, note: null } : null }));
        try {
            await axios.put("/api/hr/attendance", { userId, date: iso, status: next });
        } catch (e) {
            setOverrides((o) => { const n = { ...o }; if (before === undefined) delete n[key]; else n[key] = before; return n; });
            toast.error(extractApiError(e, "Could not mark the day"));
        }
    };

    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Attendance"
                    subtitle={data ? `${people.length} people${refreshing ? " · refreshing…" : ""}` : "Reading the register…"}
                    icon={<CalendarCheck size={20} />}
                    actions={
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={14} /></Button>
                            <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
                            <Button type="button" variant="outline" size="icon-sm" aria-label="Next month" disabled={from > today} onClick={() => move(1)}><ChevronRight size={14} /></Button>
                        </div>
                    }
                />

                <p className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {(Object.keys(ATTENDANCE_STATUS_META) as AttendanceStatus[]).map((s) => (
                        <span key={s} className="inline-flex items-center gap-1">
                            <span className={`inline-flex h-4 w-5 items-center justify-center rounded text-[10px] font-semibold ${CELL[s]}`}>{ATTENDANCE_STATUS_META[s].short}</span>
                            {ATTENDANCE_STATUS_META[s].label}
                        </span>
                    ))}
                    {canEdit && <span className="ml-auto">Click a day to mark it: P → ½ → A → L → clear. The till marks sign-ins itself.</span>}
                </p>

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-max min-w-full border-collapse text-xs">
                            <thead className="bg-muted/40">
                                <tr>
                                    <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">Staff</th>
                                    {days.map((iso) => {
                                        const wd = weekdayOf(iso);
                                        return (
                                            <th key={iso} className={`px-0.5 py-1 text-center font-normal ${wd === 0 ? "text-red-600" : "text-muted-foreground"} ${iso === today ? "bg-primary/10" : ""}`} title={holidayDates.has(iso) ? data.holidays.find((h) => h.date === iso)?.name : undefined}>
                                                <div className="text-[10px]">{DOW[wd]}</div>
                                                <div className="font-medium text-foreground">{Number(iso.slice(8, 10))}</div>
                                            </th>
                                        );
                                    })}
                                    <th className="px-2 py-2 text-right font-medium">P</th>
                                    <th className="px-2 py-2 text-right font-medium">A</th>
                                    <th className="px-2 py-2 text-right font-medium">L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {people.length === 0 ? (
                                    <tr><td colSpan={days.length + 4} className="px-3 py-6 text-center text-muted-foreground">Nobody on the staff this month.</td></tr>
                                ) : people.map((p) => {
                                    const t = summarise(p, days, holidayDates);
                                    return (
                                        <tr key={p.id} className="border-t border-border">
                                            <td className="sticky left-0 z-10 bg-card px-3 py-1">
                                                <div className="flex items-center gap-2">
                                                    <UserAvatar avatarUrl={p.avatarUrl} name={p.name} role={p.role} sizePx={22} />
                                                    <span className="whitespace-nowrap font-medium">{p.name}</span>
                                                </div>
                                            </td>
                                            {days.map((iso) => {
                                                const r = readDay(p, iso, holidayDates);
                                                if (r.kind === "outside") return <td key={iso} className="px-0.5 py-1 text-center text-muted-foreground/40">·</td>;
                                                const status = r.kind === "marked" ? r.status : null;
                                                const stored = r.kind === "marked" && r.stored;
                                                const m = p.marks[iso];
                                                const tip = [
                                                    status ? ATTENDANCE_STATUS_META[status].label : "Unmarked",
                                                    m?.source === "COUNTER" ? `till${m.firstInAt ? ` in ${fmtTime(m.firstInAt)}` : ""}${m.lastOutAt ? ` out ${fmtTime(m.lastOutAt)}` : ""}` : "",
                                                    m?.note ?? "",
                                                ].filter(Boolean).join(" · ");
                                                return (
                                                    <td key={iso} className="px-0.5 py-1 text-center">
                                                        <button
                                                            type="button"
                                                            title={tip}
                                                            aria-label={`${p.name}, ${iso}: ${tip}`}
                                                            disabled={!canEdit || iso > today}
                                                            onClick={() => void mark(p.id, iso, stored ? status : null)}
                                                            className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${status ? CELL[status] : "border border-dashed border-border text-muted-foreground/60"} ${stored && m?.source === "COUNTER" ? "ring-1 ring-emerald-400/60" : ""} ${canEdit && iso <= today ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : "cursor-default"}`}
                                                        >
                                                            {status ? ATTENDANCE_STATUS_META[status].short : ""}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                            <td className="px-2 py-1 text-right tabular-nums">{t.present + t.half / 2}</td>
                                            <td className="px-2 py-1 text-right tabular-nums">{t.absent}</td>
                                            <td className="px-2 py-1 text-right tabular-nums">{t.leave}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
