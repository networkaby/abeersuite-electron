"use client";

// Employee Activity → the day review: one day, the whole staff, and which
// answer each person's day is paid on.
//
// Owner, 2026-10-13: *"in place of accept reject we have toggle which data to
// take. in the attendance page users manual input overrides auto."* A day can
// carry both at once (the rule is `shared/lib/hr/attendanceSource.ts`):
//
//   Auto   — the activity card: the till's figures, each one correctable on the
//            card (open the row). The card's accounting says why the day adds or
//            takes away pay, which is what makes auto worth trusting.
//   Manual — the mark from the Attendance page (or set here). Marking flips the
//            day to manual; the toggle flips it back without losing the mark.
//
// Changes paint at once and roll back if the server refuses (AGENTS §7).

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import UserAvatar from "@/shared/components/UserAvatar";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { cn } from "@/shared/lib/format/utils";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { ATTENDANCE_STATUS_META, LEAVE_KIND_LABELS, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { DayReviewPayload, DayReviewRow } from "../lib/attendanceTypes";
import type { HoursPayload } from "../lib/attendanceHoursTypes";
import { saveCorrection, saveDaySource } from "../lib/attendanceDayClient";
import DayActivityCard from "./DayActivityCard";

/** What a person may set by hand from here — the register's own four. */
const MARKS: AttendanceStatus[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE"];

const GRADE_LABEL: Record<DayReviewRow["grade"], string> = { PRESENT: "Full day", HALF_DAY: "Half day", ABSENT: "Absent" };

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const shiftDay = (iso: string, by: number) =>
    new Date(Date.parse(`${iso}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** "Fri, 9 Oct 2026" — the weekday matters here: it says whether it was an off day. */
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

export default function AttendanceDayReview({ canEdit }: { canEdit: boolean }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    // The day rides the URL (`?date=`), so a link can open a given day and a
    // refresh stays on it. No date = the server's default,
    // yesterday — the most recent finished day.
    const dateParam = searchParams.get("date");
    const { data, loading, refreshing, error, reload } = useApiResource<DayReviewPayload>(
        `/api/hr/attendance/review${dateParam ? `?date=${dateParam}` : ""}`,
        { keepPrevious: true },
    );
    // A mark or decision made on another machine — or this one's own save once
    // the replica has it — re-reads the day.
    useRealtimeTopics(["settings"], reload);
    const date = dateParam ?? data?.date ?? "";
    const today = data?.today ?? "";

    const goTo = (iso: string) => {
        if (!iso) return;
        const next = new URLSearchParams(searchParams.toString());
        next.set("date", iso);
        router.replace(`/office/hr/activity?${next.toString()}`, { scroll: false });
    };

    // Optimistic decisions laid over the payload. Tied to the payload they were
    // made on, so the next read — the server's truth — replaces them wholesale.
    const [pending, setPending] = useState<{ on: DayReviewPayload | undefined; byUser: Record<number, Partial<DayReviewRow>> }>({ on: undefined, byUser: {} });
    const [busy, setBusy] = useState(false);
    const rows = useMemo(() => {
        const over = pending.on === data ? pending.byUser : {};
        return (data?.rows ?? []).map((r) => ({ ...r, ...over[r.userId] }));
    }, [data, pending]);

    const finished = !!date && !!today && date < today;
    // The toggle and the marks work on any day; a correction only on a finished
    // one (the server says the same).
    const editable = canEdit && data?.date === date;
    const counts = useMemo(() => {
        const c = { AUTO: 0, MANUAL: 0 };
        for (const r of rows) if (r.uses) c[r.uses] += 1;
        return c;
    }, [rows]);

    const paint = (userId: number, patch: Partial<DayReviewRow>) =>
        setPending((p) => {
            const byUser = { ...(p.on === data ? p.byUser : {}) };
            byUser[userId] = { ...byUser[userId], ...patch };
            return { on: data, byUser };
        });
    const unpaint = (userId: number) =>
        setPending((p) => {
            if (p.on !== data) return p;
            const byUser = { ...p.byUser };
            delete byUser[userId];
            return { on: data, byUser };
        });

    const run = async (userId: number, patch: Partial<DayReviewRow>, write: () => Promise<unknown>, failed: string) => {
        if (!editable) return;
        paint(userId, patch);
        setBusy(true);
        try {
            await write();
            await reload();
        } catch (e) {
            unpaint(userId);
            toast.error(extractApiError(e, failed));
        } finally {
            setBusy(false);
        }
    };

    /** Which side pays. */
    const flip = (r: DayReviewRow, uses: "AUTO" | "MANUAL") =>
        run(r.userId, { uses }, () => saveDaySource(r.userId, date, { useManual: uses === "MANUAL" }), "Could not switch the day");

    /** The Attendance page's own mark — it flips the day to manual. `null` clears it. */
    const mark = (r: DayReviewRow, status: AttendanceStatus | null) =>
        run(
            r.userId,
            status ? { uses: "MANUAL", manualStatus: status } : { uses: r.canAuto ? "AUTO" : null, manualStatus: null },
            () => axios.put("/api/hr/attendance", { userId: r.userId, date, status }),
            "Could not mark the day",
        );

    // Rows opened to their day card. Tied to the day they were opened on, so
    // moving to another day starts with every card shut.
    const [opened, setOpened] = useState<{ date: string; ids: Set<number> }>({ date: "", ids: new Set() });
    const openIds = opened.date === date ? opened.ids : new Set<number>();
    const toggle = (id: number) => {
        const ids = new Set(openIds);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        setOpened({ date, ids });
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-6">
            <div className="mb-2 mt-1 flex items-center gap-2">
                <ListChecks size={18} className="text-primary" />
                <div className="flex-1">
                    <h1 className="text-base font-semibold tracking-tight">Day review</h1>
                    <p className="text-xs text-muted-foreground">
                        Each day is paid on <b>Auto</b> — the activity card, whose figures you can correct (open the
                        row) — or on <b>Manual</b>, the mark from the Attendance page. Marking a day switches it to
                        Manual. Pick a name on the left for their whole month.
                    </p>
                </div>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Previous day" onClick={() => goTo(shiftDay(date, -1))} disabled={!date}>
                    <ChevronLeft size={14} />
                </Button>
                <TallyDateInput value={date} onValueChange={goTo} className="h-8 w-36" />
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Next day" onClick={() => goTo(shiftDay(date, 1))} disabled={!date || date >= today}>
                    <ChevronRight size={14} />
                </Button>
                {/* Always on screen, so the bar does not change height with the read. */}
                <span className="min-w-40 text-xs text-muted-foreground">
                    {date ? fmtDay(date) : "Reading…"}
                    {refreshing && " · refreshing…"}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {counts.AUTO} on auto · {counts.MANUAL} on manual
                </span>
            </div>

            {date && today && !finished && (
                <p className="mb-2 text-xs text-muted-foreground">
                    {date === today
                        ? "Today is still running — its figures can be corrected from tomorrow."
                        : "This day has not happened yet."}
                </p>
            )}

            {error && <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />}

            <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Staff</TableHead>
                            <TableHead>In – out</TableHead>
                            <TableHead className="text-right">Worked</TableHead>
                            <TableHead>Auto says</TableHead>
                            <TableHead>Manual</TableHead>
                            <TableHead>Paid on</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!data && (
                            <TableRow>
                                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Reading…</TableCell>
                            </TableRow>
                        )}
                        {data && !rows.length && (
                            <TableRow>
                                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Nobody was on the staff that day.</TableCell>
                            </TableRow>
                        )}
                        {rows.map((r) => (
                            <Fragment key={r.userId}>
                            <TableRow className="cursor-pointer" title="Click to open the day card" onClick={() => toggle(r.userId)}>
                                <TableCell className="text-muted-foreground">
                                    {openIds.has(r.userId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={24} className="shrink-0" />
                                        <span className="text-sm font-medium">{r.name}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-sm tabular-nums text-muted-foreground">
                                    {r.firstInAt || r.lastOutAt ? `${fmtTime(r.firstInAt)} – ${fmtTime(r.lastOutAt)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm tabular-nums">
                                    {r.workedMinutes > 0 ? (
                                        <>
                                            <span className={cn(r.corrected.worked && "text-sky-700 dark:text-sky-400")} title={r.corrected.worked ? `Corrected${r.correctedBy ? ` by ${r.correctedBy}` : ""} — till said ${formatWorked(r.till.workedMinutes)}` : undefined}>
                                                {formatWorked(r.workedMinutes)}
                                            </span>
                                            <span className="text-muted-foreground"> / {formatWorked(r.dutyMinutes)}</span>
                                        </>
                                    ) : "—"}
                                </TableCell>
                                <TableCell className={cn("text-sm", r.uses === "MANUAL" && "text-muted-foreground")}>{autoSays(r)}</TableCell>
                                {/* Marking and switching must not open or shut the card. */}
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                    <MarkBox row={r} editable={editable && !busy} onMark={(status) => mark(r, status)} />
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                    <SourceToggle row={r} editable={editable && !busy} onFlip={(uses) => flip(r, uses)} />
                                </TableCell>
                            </TableRow>
                            {openIds.has(r.userId) && (
                                <DayCardRow
                                    userId={r.userId} date={date} today={today}
                                    canCorrect={editable && finished}
                                    // The server's row, not the optimistic paint — the card must
                                    // re-read only once the change has landed.
                                    stamp={stampOf(data?.rows.find((x) => x.userId === r.userId))}
                                    onChanged={reload}
                                />
                            )}
                            </Fragment>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

/**
 * The person's own day card under their row — the very card their month view
 * draws, read only when opened (one person, one day) and cached by URL, so
 * opening it again costs no read. Corrections made on it re-read both the card
 * and the day's row.
 */
function DayCardRow({ userId, date, today, canCorrect, stamp, onChanged }: {
    userId: number;
    date: string;
    today: string;
    canCorrect: boolean;
    /** The row's side and mark — when either moves, the open card re-reads. */
    stamp: string;
    onChanged: () => Promise<unknown> | void;
}) {
    const { data, error, reload } = useApiResource<HoursPayload>(`/api/hr/attendance/hours?userId=${userId}&from=${date}&to=${date}`);
    const seen = useRef(stamp);
    useEffect(() => {
        if (seen.current === stamp) return;
        seen.current = stamp;
        void reload();
    }, [stamp, reload]);
    const day = data?.days.find((d) => d.date === date) ?? null;
    const correct = async (field: "worked" | "late", minutes: number | null) => {
        try {
            await saveCorrection(userId, date, field, minutes);
            await Promise.all([reload(), onChanged()]);
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the correction"));
            throw e;
        }
    };
    return (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={7} className="py-3">
                {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                ) : !data ? (
                    <p className="text-sm text-muted-foreground">Reading the day…</p>
                ) : !day ? (
                    <p className="text-sm text-muted-foreground">Not on the staff that day.</p>
                ) : (
                    <DayActivityCard
                        day={day} rules={data.rules} idleLimitMinutes={data.idleLimitMinutes} isToday={date === today}
                        onCorrect={canCorrect && day.tracked ? correct : undefined}
                    />
                )}
            </TableCell>
        </TableRow>
    );
}

const stampOf = (r: DayReviewRow | undefined) => `${r?.uses}|${r?.manualStatus}`;

/** Auto's reading of the day in a phrase — or why there is nothing to read. */
function autoSays(r: DayReviewRow): string {
    if (!r.canAuto) {
        if (r.holidayName) return `Holiday — ${r.holidayName}`;
        if (r.weeklyOff) return "Weekly off";
        if (r.leaveKind) return `${LEAVE_KIND_LABELS[r.leaveKind]} leave`;
        return r.uses ? "Nothing from the till" : "No record — paid as a normal day";
    }
    if (r.workedMinutes <= 0) return "Signed in, no working time measured";
    // A shut day owes no duty: every minute is extra, paid at its own rate.
    if (r.holidayName) return `Worked on the holiday (${r.holidayName})`;
    if (r.weeklyOff) return "Worked on the weekly off";
    const bits = [GRADE_LABEL[r.grade]];
    if (r.lateBy > 0) bits.push(`late ${formatWorked(r.lateBy)}`);
    if (r.overtimeMinutes > 0) bits.push(`extra ${formatWorked(r.overtimeMinutes)}`);
    if (r.grade !== "ABSENT" && r.shortMinutes > 0) bits.push(`short ${formatWorked(r.shortMinutes)}`);
    if (r.corrected.worked || r.corrected.late) bits.push("corrected");
    return bits.join(" · ");
}

/** The manual side: the Attendance page's own mark, settable from here too. */
function MarkBox({ row, editable, onMark }: {
    row: DayReviewRow;
    editable: boolean;
    onMark: (status: AttendanceStatus | null) => void;
}) {
    if (!editable) {
        return <span className="text-sm text-muted-foreground">{row.manualStatus ? ATTENDANCE_STATUS_META[row.manualStatus].label : "—"}</span>;
    }
    return (
        <Select value={row.manualStatus ?? ""} onValueChange={(v) => onMark(v === "CLEAR" ? null : v as AttendanceStatus)}>
            <SelectTrigger className="h-7 w-28 text-xs" aria-label={`Mark ${row.name} by hand`}>
                <SelectValue placeholder="Mark…" />
            </SelectTrigger>
            <SelectContent>
                {MARKS.map((s) => (
                    <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_META[s].label}</SelectItem>
                ))}
                {row.manualStatus && <SelectItem value="CLEAR">Clear the mark</SelectItem>}
            </SelectContent>
        </Select>
    );
}

/** Auto | Manual — which side the day is paid on. A side with nothing in it is greyed. */
function SourceToggle({ row, editable, onFlip }: {
    row: DayReviewRow;
    editable: boolean;
    onFlip: (uses: "AUTO" | "MANUAL") => void;
}) {
    if (!row.uses) return <span className="text-xs text-muted-foreground">—</span>;
    const side = (uses: "AUTO" | "MANUAL", label: string, available: boolean, why: string) => {
        const on = row.uses === uses;
        return (
            <button
                type="button"
                disabled={!editable || on || !available}
                onClick={() => onFlip(uses)}
                title={available ? undefined : why}
                className={cn(
                    "px-2 py-0.5 text-xs font-medium transition-colors",
                    on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    !available && "opacity-40",
                )}
            >
                {label}
            </button>
        );
    };
    return (
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label={`Which side ${row.name}'s day is paid on`}>
            {side("AUTO", "Auto", row.canAuto, "The till recorded nothing on this day")}
            {side("MANUAL", "Manual", !!row.manualStatus, "No manual mark yet — pick one in the Manual column")}
        </div>
    );
}
