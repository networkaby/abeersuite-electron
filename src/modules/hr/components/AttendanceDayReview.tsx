"use client";

// Employee Activity → the day review: one day, the whole staff, and the owner's
// decision on what the till measured.
//
// Owner, 2026-10-12: *"auto attendance is under testing only let accept/edit/
// override since its not sure 100% correct"* — and *"its better to have all
// employee together for the day so i can review whole group"*. So the till's
// minutes reach no pay until somebody accepts them here (the rule itself is
// `shared/lib/hr/attendanceReview.ts`):
//
//   Accept — the clock's figures count: half / absent, overtime, late, short.
//   Reject — the clock is ignored; the day is paid as a normal full day.
//   Mark   — a person sets the day by hand; the register's own mark, which has
//            always overruled the clock.
//
// A day nobody has decided is paid as a normal day, and Payroll says how many
// are still waiting. Only a finished day can be decided: today is still running.
//
// Decisions paint at once and roll back if the server refuses (AGENTS §7).

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ListChecks, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import UserAvatar from "@/shared/components/UserAvatar";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { ATTENDANCE_REVIEW_LABELS, type AttendanceReview, type AttendanceReviewDecision } from "@/shared/lib/hr/attendanceReview";
import { ATTENDANCE_STATUS_META, LEAVE_KIND_LABELS, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { DayReviewPayload, DayReviewRow } from "../lib/attendanceTypes";
import type { HoursPayload } from "../lib/attendanceHoursTypes";
import DayActivityCard from "./DayActivityCard";

/** What a person may set by hand from here — the register's own four. */
const MARKS: AttendanceStatus[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE"];

const GRADE_LABEL: Record<DayReviewRow["grade"], string> = { PRESENT: "Full day", HALF_DAY: "Half day", ABSENT: "Absent" };

const REVIEW_TONE: Record<AttendanceReview, string> = {
    WAITING:  "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    ACCEPTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    REJECTED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

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
    // The day rides the URL (`?date=`), so Payroll can link straight to a day
    // still waiting and a refresh stays on it. No date = the server's default,
    // yesterday — the most recent finished day.
    const dateParam = searchParams.get("date");
    const { data, loading, refreshing, error, reload } = useApiResource<DayReviewPayload>(
        `/api/hr/attendance/review${dateParam ? `?date=${dateParam}` : ""}`,
        { keepPrevious: true },
    );
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
    const editable = canEdit && finished && data?.date === date;
    const counts = useMemo(() => {
        const c = { WAITING: 0, ACCEPTED: 0, REJECTED: 0 } as Record<AttendanceReview, number>;
        for (const r of rows) if (r.review) c[r.review] += 1;
        return c;
    }, [rows]);
    const waitingDates = data?.waitingDates ?? [];
    const nextWaiting = waitingDates.find((d) => d > date) ?? waitingDates.find((d) => d !== date) ?? null;

    const paint = (userIds: number[], patch: Partial<DayReviewRow>) =>
        setPending((p) => {
            const byUser = { ...(p.on === data ? p.byUser : {}) };
            for (const id of userIds) byUser[id] = { ...byUser[id], ...patch };
            return { on: data, byUser };
        });
    const unpaint = (userIds: number[]) =>
        setPending((p) => {
            if (p.on !== data) return p;
            const byUser = { ...p.byUser };
            for (const id of userIds) delete byUser[id];
            return { on: data, byUser };
        });

    const decide = async (userIds: number[], review: AttendanceReviewDecision | null) => {
        if (!editable || !userIds.length) return;
        paint(userIds, { review: review ?? "WAITING", reviewedBy: review ? "you" : null });
        setBusy(true);
        try {
            await axios.post("/api/hr/attendance/review", {
                date, decisions: userIds.map((userId) => ({ userId, review })),
            });
            await reload();
        } catch (e) {
            unpaint(userIds);
            toast.error(extractApiError(e, "Could not record the decision"));
        } finally {
            setBusy(false);
        }
    };

    /** The register's own mark — `null` hands a measured day back to the clock. */
    const mark = async (userId: number, status: AttendanceStatus | null) => {
        if (!editable) return;
        if (status) paint([userId], { kind: "OFFICE", status, review: null });
        setBusy(true);
        try {
            await axios.put("/api/hr/attendance", { userId, date, status });
            await reload();
        } catch (e) {
            unpaint([userId]);
            toast.error(extractApiError(e, "Could not mark the day"));
        } finally {
            setBusy(false);
        }
    };

    // Rows opened to their day card. Tied to the day they were opened on, so
    // moving to another day starts with every card shut.
    const [opened, setOpened] = useState<{ date: string; ids: Set<number> }>({ date: "", ids: new Set() });
    const openIds = opened.date === date ? opened.ids : new Set<number>();
    const toggle = (id: number) => {
        const ids = new Set(openIds);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        setOpened({ date, ids });
    };

    const waitingIds = rows.filter((r) => r.review === "WAITING").map((r) => r.userId);

    return (
        <div className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-6">
            <div className="mb-2 mt-1 flex items-center gap-2">
                <ListChecks size={18} className="text-primary" />
                <div className="flex-1">
                    <h1 className="text-base font-semibold tracking-tight">Day review</h1>
                    <p className="text-xs text-muted-foreground">
                        Auto attendance is on trial: the till&apos;s figures change nobody&apos;s pay until they are
                        accepted here. Rejected or still waiting, the day is paid as a normal day. Pick a name on the
                        left for their whole month.
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
                <span className="text-xs tabular-nums text-muted-foreground">
                    {counts.WAITING} waiting · {counts.ACCEPTED} accepted · {counts.REJECTED} rejected
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => nextWaiting && goTo(nextWaiting)} disabled={!nextWaiting}>
                        {waitingDates.length
                            ? `Next waiting day (${waitingDates.length} in all)`
                            : "No day waiting"}
                    </Button>
                    {canEdit && (
                        <Button type="button" size="sm" className="h-8" onClick={() => decide(waitingIds, "ACCEPTED")} disabled={!editable || busy || !waitingIds.length}>
                            <Check size={14} /> Accept all waiting
                        </Button>
                    )}
                </div>
            </div>

            {date && today && !finished && (
                <p className="mb-2 text-xs text-muted-foreground">
                    {date === today
                        ? "Today is still running — its figures can be decided from tomorrow."
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
                            <TableHead>The clock says</TableHead>
                            <TableHead>Decision</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!data && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Reading…</TableCell>
                            </TableRow>
                        )}
                        {data && !rows.length && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Nobody was on the staff that day.</TableCell>
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
                                            {formatWorked(r.workedMinutes)}
                                            <span className="text-muted-foreground"> / {formatWorked(r.dutyMinutes)}</span>
                                        </>
                                    ) : "—"}
                                </TableCell>
                                <TableCell className="text-sm">{clockSays(r)}</TableCell>
                                {/* Deciding must not open or shut the card. */}
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                    <Decision
                                        row={r}
                                        editable={editable && !busy}
                                        onDecide={(review) => decide([r.userId], review)}
                                        onMark={(status) => mark(r.userId, status)}
                                    />
                                </TableCell>
                            </TableRow>
                            {openIds.has(r.userId) && <DayCardRow userId={r.userId} date={date} today={today} />}
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
 * opening it again costs no read.
 */
function DayCardRow({ userId, date, today }: { userId: number; date: string; today: string }) {
    const { data, error } = useApiResource<HoursPayload>(`/api/hr/attendance/hours?userId=${userId}&from=${date}&to=${date}`);
    const day = data?.days.find((d) => d.date === date) ?? null;
    return (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={6} className="py-3">
                {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                ) : !data ? (
                    <p className="text-sm text-muted-foreground">Reading the day…</p>
                ) : !day ? (
                    <p className="text-sm text-muted-foreground">Not on the staff that day.</p>
                ) : (
                    <DayActivityCard day={day} rules={data.rules} idleLimitMinutes={data.idleLimitMinutes} isToday={date === today} />
                )}
            </TableCell>
        </TableRow>
    );
}

/** The clock's reading of the day in a phrase — or why there is nothing to read. */
function clockSays(r: DayReviewRow): string {
    if (r.kind === "OFFICE") {
        const label = r.status ? ATTENDANCE_STATUS_META[r.status].label : "Marked";
        return `Marked ${label.toLowerCase()} by hand${r.note ? ` — ${r.note}` : ""}`;
    }
    if (r.kind === "NONE") {
        if (r.holidayName) return `Holiday — ${r.holidayName}`;
        if (r.weeklyOff) return "Weekly off";
        if (r.leaveKind) return `${LEAVE_KIND_LABELS[r.leaveKind]} leave`;
        return "No record — paid as a normal day";
    }
    if (r.kind === "IDLE") return "Signed in, no working time measured";
    // A shut day owes no duty: every minute is extra, paid at its own rate.
    if (r.holidayName) return `Worked on the holiday (${r.holidayName})`;
    if (r.weeklyOff) return "Worked on the weekly off";
    const bits = [GRADE_LABEL[r.grade]];
    if (r.lateBy > 0) bits.push(`late ${formatWorked(r.lateBy)}`);
    if (r.overtimeMinutes > 0) bits.push(`extra ${formatWorked(r.overtimeMinutes)}`);
    if (r.grade !== "ABSENT" && r.shortMinutes > 0) bits.push(`short ${formatWorked(r.shortMinutes)}`);
    return bits.join(" · ");
}

function Decision({ row, editable, onDecide, onMark }: {
    row: DayReviewRow;
    editable: boolean;
    onDecide: (review: AttendanceReviewDecision | null) => void;
    onMark: (status: AttendanceStatus | null) => void;
}) {
    const tag = row.review && (
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${REVIEW_TONE[row.review]}`}>
            {ATTENDANCE_REVIEW_LABELS[row.review]}
        </span>
    );
    // Marking by hand is offered on every row: it is how a day with no record is
    // set absent, and how a clock day is corrected rather than merely refused.
    const markBox = editable && (
        <Select value="" onValueChange={(v) => onMark(v === "CLEAR" ? null : v as AttendanceStatus)}>
            <SelectTrigger className="h-7 w-28 text-xs" aria-label={`Mark ${row.name} by hand`}>
                <SelectValue placeholder="Mark…" />
            </SelectTrigger>
            <SelectContent>
                {MARKS.map((s) => (
                    <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_META[s].label}</SelectItem>
                ))}
                {row.kind === "OFFICE" && <SelectItem value="CLEAR">Clear the mark</SelectItem>}
            </SelectContent>
        </Select>
    );

    if (row.kind !== "CLOCK") {
        return (
            <div className="flex flex-wrap items-center gap-2">
                {row.kind === "OFFICE" && (
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">Marked</span>
                )}
                {markBox}
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            {tag}
            {row.review === "WAITING" ? (
                editable && (
                    <>
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDecide("ACCEPTED")}>
                            <Check size={12} /> Accept
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDecide("REJECTED")}>
                            <X size={12} /> Reject
                        </Button>
                    </>
                )
            ) : (
                <>
                    {row.reviewedBy && <span className="text-xs text-muted-foreground">by {row.reviewedBy}</span>}
                    {row.review === "REJECTED" && <span className="text-xs text-muted-foreground">· paid as a normal day</span>}
                    {editable && (
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onDecide(null)}>
                            <Undo2 size={12} /> Undo
                        </Button>
                    )}
                </>
            )}
            {markBox}
        </div>
    );
}
