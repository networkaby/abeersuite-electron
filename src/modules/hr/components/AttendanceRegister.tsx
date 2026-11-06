"use client";

// The attendance register — one month, everyone down the side, a cell per day.
// The till fills in the sign-ins; HR clicks a cell to mark it. A click cycles
// P → ½ → A → L → Auto (an Auto day's first click is P). Auto drops the office mark: a day the till measured
// shows the till's own answer again (green ring), any other day reads off the calendar again
// (weekly off, holiday, approved leave, or unmarked).

import { useMemo, useState, type ReactNode } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { toast } from "sonner";
import { CalendarCheck, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import UserAvatar from "@/shared/components/UserAvatar";
import { HelpButton } from "@/shared/components/HelpButton";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, monthBounds, readDay, summarise, weekdayOf, holidayDatesFor } from "../lib/attendanceCalendar";
import { CELL, DOW } from "../lib/attendanceStyles";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import type { AttendanceMark, RegisterPayload } from "../lib/attendanceTypes";
import AttendanceBulkDialog, { type BulkCell } from "./AttendanceBulkDialog";

const CYCLE: (AttendanceStatus | null)[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", null];

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
    // Every listed holiday, for the column tooltip; each person's own set is
    // narrowed by branch when a row is read.
    const holidays = useMemo(() => data?.holidays ?? [], [data]);
    const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
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

    /**
     * `shut` is the day's own off status (holiday / weekly off) for this person.
     * On such a day the cycle starts with it — a manual W / H says "it was an
     * off day, the till's minutes were not work" (testing on the off day, owner
     * 2026-11-06), so payroll pays no extra duty on it.
     */
    const mark = async (userId: number, iso: string, current: AttendanceStatus | null, shut: "HOLIDAY" | "WEEKLY_OFF" | null) => {
        if (!canEdit || iso > today) return;
        const cycle = shut ? [shut, ...CYCLE] : CYCLE;
        const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
        const key = `${userId}|${iso}`;
        const before = overrides[key];
        // An office mark carries no worked minutes of its own — it is HR overruling
        // the clock, and readDay() stops grading the day the moment source is OFFICE.
        // Back to Auto on a day the till measured: the till's grade comes from the
        // server, so nothing is painted early — the reload brings it in.
        const under = data?.people.find((p) => p.id === userId)?.marks[iso];
        const tillUnder = next === null && !!under && (under.workedMinutes > 0 || !!under.firstInAt);
        if (!tillUnder) setOverrides((o) => ({ ...o, [key]: next ? { status: next, source: "OFFICE", firstInAt: null, lastOutAt: null, workedMinutes: 0, note: null } : null }));
        try {
            await axios.put("/api/hr/attendance", { userId, date: iso, status: next });
            if (tillUnder) { setOverrides((o) => { const n = { ...o }; delete n[key]; return n; }); reload(); }
        } catch (e) {
            setOverrides((o) => { const n = { ...o }; if (before === undefined) delete n[key]; else n[key] = before; return n; });
            toast.error(extractApiError(e, "Could not mark the day"));
        }
    };

    // Bulk mark: null = closed, "" = open on the whole month, an ISO = open on that day.
    const [bulkDay, setBulkDay] = useState<string | null>(null);
    const officeMark = (status: AttendanceStatus): AttendanceMark => ({ status, source: "OFFICE", firstInAt: null, lastOutAt: null, workedMinutes: 0, note: null });
    const bulkMark = async (cells: BulkCell[], status: AttendanceStatus | null) => {
        const before = overrides;
        setOverrides((o) => {
            const n = { ...o };
            // A cleared till day goes back to auto — the reload paints it; meanwhile
            // only office-only cells are blanked optimistically.
            for (const c of cells) {
                const key = `${c.userId}|${c.date}`;
                if (status) n[key] = officeMark(status);
                else if (data?.people.find((p) => p.id === c.userId)?.marks[c.date]?.workedMinutes === 0) n[key] = null;
            }
            return n;
        });
        try {
            const res = await axios.post<{ count: number }>("/api/hr/attendance/bulk", { cells, status });
            toast.success(`${status ? "Marked" : "Set back to Auto:"} ${res.data.count} day${res.data.count === 1 ? "" : "s"}`);
            if (!status) reload();
        } catch (e) {
            setOverrides(before);
            toast.error(extractApiError(e, "Could not mark the days"));
            throw e;
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
                            <HelpButton title="Reading the attendance register">
                                <RegisterHelp canEdit={canEdit} />
                            </HelpButton>
                            {canEdit && from <= today && (
                                <Button type="button" variant="outline" size="sm" className="mr-2" disabled={!data} onClick={() => setBulkDay("")}>
                                    <ListChecks size={14} /> Bulk mark
                                </Button>
                            )}
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
                    <span className="inline-flex items-center gap-1 border-l border-border pl-3">
                        <span className={`inline-flex h-4 w-5 items-center justify-center rounded text-[10px] font-semibold ring-1 ring-emerald-400/60 ${CELL.PRESENT}`}>P</span>
                        Auto (till)
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className={`inline-flex h-4 w-5 items-center justify-center rounded text-[10px] font-semibold ${CELL.PRESENT}`}>P</span>
                        Manual (office)
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className={`relative inline-flex h-4 w-5 items-center justify-center rounded text-[10px] font-semibold ${CELL.PRESENT}`}>
                            P<span aria-hidden className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-amber-500" />
                        </span>
                        Late
                    </span>
                    {canEdit && <span className="ml-auto">Click a day to mark it: P → ½ → A → L → Auto (W / H first on off days). Click a date at the top, or Bulk mark, to mark many at once. The till marks sign-ins itself.</span>}
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
                                                {canEdit && iso <= today ? (
                                                    <button type="button" className="font-medium text-foreground hover:text-primary hover:underline" title="Bulk mark this day" onClick={() => setBulkDay(iso)}>
                                                        {Number(iso.slice(8, 10))}
                                                    </button>
                                                ) : (
                                                    <div className="font-medium text-foreground">{Number(iso.slice(8, 10))}</div>
                                                )}
                                            </th>
                                        );
                                    })}
                                    <th className="px-2 py-2 text-right font-medium">P</th>
                                    <th className="px-2 py-2 text-right font-medium">A</th>
                                    <th className="px-2 py-2 text-right font-medium" title="Incomplete duty — came, under 40% of duty">ID</th>
                                    <th className="px-2 py-2 text-right font-medium">L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {people.length === 0 ? (
                                    <tr><td colSpan={days.length + 5} className="px-3 py-6 text-center text-muted-foreground">Nobody on the staff this month.</td></tr>
                                ) : people.map((p) => {
                                    const mine = holidayDatesFor(holidays, p.branchIds);
                                    const t = summarise(p, days, mine);
                                    return (
                                        <tr key={p.id} className="border-t border-border">
                                            <td className="sticky left-0 z-10 bg-card px-3 py-1">
                                                {/* The register answers "what did the month look like".
                                                    The name answers "and why": Employee Activity opens
                                                    on this person, day by day, stretch by stretch. */}
                                                <GatedLink whenLocked="text" textClassName="flex items-center gap-2 text-left"
                                                    href={`/office/hr/activity?user=${p.id}`}
                                                    className="flex items-center gap-2 text-left hover:underline"
                                                    title={`${p.name} — hours, day by day`}
                                                >
                                                    <UserAvatar avatarUrl={p.avatarUrl} name={p.name} role={p.role} sizePx={22} />
                                                    <span className="whitespace-nowrap font-medium">{p.name}</span>
                                                </GatedLink>
                                            </td>
                                            {days.map((iso) => {
                                                const r = readDay(p, iso, mine);
                                                if (r.kind === "outside") return <td key={iso} className="px-0.5 py-1 text-center text-muted-foreground/40">·</td>;
                                                const status = r.kind === "marked" ? r.status : null;
                                                const stored = r.kind === "marked" && r.stored;
                                                const m = p.marks[iso];
                                                const shut = mine.has(iso) ? "HOLIDAY" as const : p.weeklyOff.includes(weekdayOf(iso)) ? "WEEKLY_OFF" as const : null;
                                                // The hours belong in the tooltip: a bare "½" that nobody can
                                                // question is worse than no grade at all, and this is the number
                                                // the grade was worked out from.
                                                const worked = r.kind === "marked" && r.workedMinutes ? formatWorked(r.workedMinutes) : "";
                                                const lateBy = r.kind === "marked" ? (r.lateBy ?? 0) : 0;
                                                const tip = [
                                                    status ? ATTENDANCE_STATUS_META[status].label : "Unmarked",
                                                    r.kind === "marked" && r.extraDuty ? "extra duty" : "",
                                                    worked ? `${worked} worked${r.kind === "marked" && r.graded ? " (auto)" : ""}` : "",
                                                    lateBy > 0 ? `late by ${formatWorked(lateBy)}` : "",
                                                    // "COUNTER" on the row means the MACHINE wrote it, not that a till
                                                    // did — the pulse can write one from anywhere. So the times are
                                                    // named plainly instead of claiming a counter nobody recorded.
                                                    m?.source === "COUNTER" ? `${m.firstInAt ? `in ${fmtTime(m.firstInAt)}` : ""}${m.lastOutAt ? ` · out ${fmtTime(m.lastOutAt)}` : ""}`.trim() : "",
                                                    m?.source === "OFFICE" ? "marked by office" : "",
                                                    m?.note ?? "",
                                                ].filter(Boolean).join(" · ");
                                                return (
                                                    <td key={iso} className="px-0.5 py-1 text-center">
                                                        <button
                                                            type="button"
                                                            title={tip}
                                                            aria-label={`${p.name}, ${iso}: ${tip}`}
                                                            disabled={!canEdit || iso > today}
                                                            // Auto (till) day: the cycle starts at its top — W / H on an off
                                                            // day, else P. A plain calendar W / H starts after it (it already
                                                            // reads W / H). Manual: steps on from its own mark.
                                                            onClick={() => void mark(p.id, iso, m?.source === "COUNTER" ? null : stored ? status : shut, shut)}
                                                            className={`relative inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${status ? CELL[status] : "border border-dashed border-border text-muted-foreground/60"} ${stored && m?.source === "COUNTER" ? "ring-1 ring-emerald-400/60" : ""} ${canEdit && iso <= today ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : "cursor-default"}`}
                                                        >
                                                            {status ? ATTENDANCE_STATUS_META[status].short : ""}
                                                            {/* A late arrival is not a different STATUS — a full day worked
                                                                late is still a full day — so it rides as a corner dot rather
                                                                than changing the letter. */}
                                                            {lateBy > 0 && (
                                                                <span aria-hidden className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                            )}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                            <td className="px-2 py-1 text-right tabular-nums">{t.present + t.half / 2}</td>
                                            <td className="px-2 py-1 text-right tabular-nums">{t.absent}</td>
                                            <td className="px-2 py-1 text-right tabular-nums">{t.incomplete}</td>
                                            <td className="px-2 py-1 text-right tabular-nums">{t.leave}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {data && canEdit && bulkDay !== null && (
                    <AttendanceBulkDialog
                        open
                        onOpenChange={(o) => { if (!o) setBulkDay(null); }}
                        people={people}
                        holidays={holidays}
                        monthFrom={from}
                        monthTo={to}
                        today={today}
                        initialDate={bulkDay || null}
                        onApply={bulkMark}
                    />
                )}
            </div>
        </ScrollArea>
    );
}

/** A sample cell for the help box. */
function Box({ children, ring, late }: { children: ReactNode; ring?: boolean; late?: boolean }) {
    return (
        <span className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold ${CELL.PRESENT} ${ring ? "ring-1 ring-emerald-400/60" : ""}`}>
            {children}
            {late && <span aria-hidden className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-amber-500" />}
        </span>
    );
}

/** The "Help" box on the register — what every mark on the grid means. */
function RegisterHelp({ canEdit }: { canEdit: boolean }) {
    return (
        <>
            <section className="space-y-2">
                <h3 className="font-semibold">Letters in a box</h3>
                <ul className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(ATTENDANCE_STATUS_META) as AttendanceStatus[]).map((s) => (
                        <li key={s} className="flex items-center gap-2">
                            <span className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${CELL[s]}`}>{ATTENDANCE_STATUS_META[s].short}</span>
                            {ATTENDANCE_STATUS_META[s].label}
                        </li>
                    ))}
                    <li className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 rounded border border-dashed border-border" /> Not marked yet
                    </li>
                </ul>
            </section>

            <section className="space-y-2">
                <h3 className="font-semibold">Auto or manual — where the mark came from</h3>
                <p className="flex items-center gap-3"><Box ring>P</Box><span><b>Thin green ring = Auto.</b> The till saw the person sign in and counted the hours. The app chose P / ½ / A from those hours by itself.</span></p>
                <p className="flex items-center gap-3"><Box>P</Box><span><b>No ring = Manual.</b> Someone in the office marked this day. A manual mark wins over the till.</span></p>
                <p className="text-muted-foreground">Not sure? Hold the mouse on a box. It shows the in / out time (auto) or &quot;marked by office&quot; (manual).</p>
            </section>

            <section className="space-y-2">
                <h3 className="font-semibold">The orange dot</h3>
                <p className="flex items-center gap-3"><Box ring late>P</Box><span><b>Orange dot = came late.</b> It is not a different status — a full day worked late is still P. Hold the mouse on the box to see by how much.</span></p>
            </section>

            <section className="space-y-2">
                <h3 className="font-semibold">Totals on the right</h3>
                <p><b>P</b> present days (a half day counts ½) · <b>A</b> absent · <b>ID</b> incomplete duty — came, but worked too few hours · <b>L</b> leave.</p>
            </section>

            {canEdit && (
                <section className="space-y-2">
                    <h3 className="font-semibold">Marking</h3>
                    <ul className="list-disc space-y-1 pl-5">
                        <li><b>One box:</b> click it. Each click goes P → ½ → A → L → <b>Auto</b>. On an Auto (green ring) box the first click is always manual P. On a weekly off or holiday the cycle starts with a manual <b>W</b> / <b>H</b>: use it when the till shows activity on an off day that was not real work (testing, a quick check) — it removes the green ring and no extra duty is paid. Auto removes the office mark: if the till recorded that day, the till&apos;s own answer comes back with the green ring; if not, the box shows the calendar again (weekly off, holiday, leave or empty).</li>
                        <li><b>Many boxes:</b> click <b>Bulk mark</b>, or click a date at the top to mark that day for everyone.</li>
                        <li>Bulk mark never overrides an Auto (till) day — click that box on its own. Its <b>Auto</b> option sets many manual days back to Auto at once.</li>
                        <li>Future days cannot be marked.</li>
                        <li>Click a name to see that person&apos;s hours day by day (Employee Activity).</li>
                    </ul>
                </section>
            )}
        </>
    );
}
