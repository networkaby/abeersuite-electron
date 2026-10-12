"use client";

// HR & People → Employee Activity, a master-detail explorer — the same shape the
// Staff Directory and the Cash Book use: a narrow list of people on the left, and
// the chosen person's month filling the main area on the right, day by day, down
// to the stretches they were actually active.
//
// With nobody picked, the main area is the DAY REVIEW: one day, the whole staff,
// and which side each day is paid on — Auto (the activity card, correctable) or
// Manual (the Attendance page's mark). See AttendanceDayReview. The month-for-everybody grid stays on the
// Attendance register next door.
//
// The left list rides the register's own payload, so it costs no extra read
// (AGENTS §7): the same rows that grid draws, counted into P / A / L.
//
// The pick rides the URL as `?user=<id>` (replaced, not pushed — one row click
// per person should not pile up history), so a refresh or a shared link opens
// the same person on the same month.

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import UserAvatar from "@/shared/components/UserAvatar";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { todayIso } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { DATE_PRESET_LABELS, presetRangeOf, type DatePresetKey } from "@/shared/lib/format/datePresets";
import { isoDaysBetween, summarise, holidayDatesFor } from "../lib/attendanceCalendar";
import type { RegisterPayload } from "../lib/attendanceTypes";
import AttendanceBreakup from "./AttendanceBreakup";
import AttendanceDayReview from "./AttendanceDayReview";

export default function AttendanceExplorer({ canEdit }: { canEdit: boolean }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const selectedId = Number(searchParams.get("user") ?? 0) || null;

    // The stretch of days the whole screen is about. One range, not one per
    // pane: the P / A / L on a name and the cards beside it must be counting the
    // same days, or the screen quietly contradicts itself.
    const today = todayIso();
    const [preset, setPreset] = useState<DatePresetKey>("thisMonth");
    const [{ from, to }, setRange] = useState(() => presetRangeOf("thisMonth", today));

    const pickPreset = useCallback((p: DatePresetKey) => {
        setPreset(p);
        if (p !== "custom") setRange(presetRangeOf(p, today));
    }, [today]);

    // A typed date is always custom — the preset it came from is no longer what
    // the reader is looking at, and a label that lies is worse than no label.
    const setFrom = useCallback((v: string) => {
        setPreset("custom");
        setRange((r) => ({ from: v, to: r.to < v ? v : r.to }));
    }, []);
    const setTo = useCallback((v: string) => {
        setPreset("custom");
        setRange((r) => ({ from: r.from > v ? v : r.from, to: v }));
    }, []);

    const { data, refreshing, error, reload } = useApiResource<RegisterPayload>(`/api/hr/attendance?from=${from}&to=${to}`);
    useRealtimeTopics(["settings"], reload);

    const [q, setQ] = useState("");

    const select = useCallback((userId: number | null) => {
        const next = new URLSearchParams(searchParams.toString());
        if (userId) next.set("user", String(userId));
        else next.delete("user");
        const qs = next.toString();
        router.replace(qs ? `/office/hr/activity?${qs}` : "/office/hr/activity", { scroll: false });
    }, [router, searchParams]);

    const days = useMemo(() => isoDaysBetween(from, to), [from, to]);
    const people = useMemo(() => data?.people ?? [], [data]);
    const holidays = useMemo(() => data?.holidays ?? [], [data]);

    // The month each person actually had, counted from the very rows the grid
    // reads — so the figure on the left row and the figure in the P/A/L columns
    // can never drift apart.
    const rows = useMemo(() => people.map((p) => ({
        person: p,
        totals: summarise(p, days, holidayDatesFor(holidays, p.branchIds)),
    })), [people, days, holidays]);

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return rows;
        return rows.filter((r) => r.person.name.toLowerCase().includes(needle));
    }, [rows, q]);

    const selected = rows.find((r) => r.person.id === selectedId) ?? null;
    // "18 Sept 2026" when the range is a single day, a span otherwise.
    const rangeLabel = from === to ? fmtDate(from) : `${fmtDate(from)} - ${fmtDate(to)}`;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Staff"
                    icon={<Users size={15} className="text-primary" />}
                    count={filtered.length}
                    search={q}
                    onSearchChange={setQ}
                    searchPlaceholder="Search name"
                    onTitleClick={selectedId ? () => select(null) : undefined}
                    isEmpty={filtered.length === 0}
                    emptyMessage={error ?? (!data ? "Reading…" : people.length === 0 ? "Nobody on the staff this month." : "Nobody matches that name.")}
                    toolbar={
                        <p className="mt-2 text-xs text-muted-foreground">
                            {rangeLabel}
                            {refreshing && " · refreshing…"}
                        </p>
                    }
                >
                    {filtered.map(({ person, totals }) => (
                        <button
                            key={person.id}
                            type="button"
                            onClick={() => select(person.id)}
                            className={cn(
                                "w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                                selectedId === person.id
                                    ? "border-l-2 border-l-primary bg-primary/10"
                                    : "border-l-2 border-l-transparent",
                            )}
                        >
                            <div className="flex items-center gap-2.5">
                                <UserAvatar avatarUrl={person.avatarUrl} name={person.name} role={person.role} sizePx={30} className="shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{person.name}</span>
                                    {/* This month in three figures. On this screen the pay never
                                        changes and the days always do, so the days are what the
                                        row carries. */}
                                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                                        <span title="Present, a half day counting as half">P {totals.present + totals.half / 2}</span>
                                        <span title="Absent" className={totals.absent > 0 ? "text-amber-600" : undefined}>A {totals.absent}</span>
                                        <span title="On leave">L {totals.leave}</span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </EntityListPanel>

                {/* ── Right section: the chosen person's month, or everybody's ── */}
                <section className="flex flex-1 flex-col overflow-y-auto bg-muted/30">
                    {selected ? (
                        <div className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-6">
                            <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => select(null)}>
                                <ArrowLeft size={14} /> Whole register
                            </Button>
                            <div className="mb-2 mt-1 flex items-center gap-2">
                                <CalendarCheck size={18} className="text-primary" />
                                <div className="flex-1">
                                    <h1 className="text-base font-semibold tracking-tight">{selected.person.name}</h1>
                                    <p className="text-xs text-muted-foreground">
                                        Every stretch actually worked. Time away from the machine for longer than the
                                        idle limit is not counted, so a forgotten sign-out costs nothing and is not paid either.
                                    </p>
                                </div>
                            </div>

                            <RangeBar
                                preset={preset}
                                onPreset={pickPreset}
                                from={from}
                                to={to}
                                onFrom={setFrom}
                                onTo={setTo}
                            />

                            <AttendanceBreakup userId={selected.person.id} from={from} to={to} canEdit={canEdit} />
                        </div>
                    ) : selectedId && !data ? (
                        // A link straight to ?user=<id> arrives before the staff read
                        // lands. The day review under a heading that names nobody would
                        // flash up for the second before the person's month replaces it.
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Reading…</div>
                    ) : (
                        <AttendanceDayReview canEdit={canEdit} />
                    )}
                </section>
            </div>
        </div>
    );
}

/** "22 Sept 2026" — short enough for a chip, unambiguous about the year. */
function fmtDate(iso: string): string {
    if (!iso) return "—";
    return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
}

/**
 * Which days are being read — a named stretch, or two dates typed by hand.
 *
 * The presets are the shop-wide ones (`datePresets.ts`), so "this month" here
 * and "this month" on a register mean the same days. A single day needs no
 * control of its own: "Today", or the same date typed in both boxes, already is
 * a range of one.
 */
function RangeBar({ preset, onPreset, from, to, onFrom, onTo }: {
    preset: DatePresetKey;
    onPreset: (p: DatePresetKey) => void;
    from: string;
    to: string;
    onFrom: (v: string) => void;
    onTo: (v: string) => void;
}) {
    const PRESETS: DatePresetKey[] = ["today", "yesterday", "last7", "thisWeek", "thisMonth", "lastMonth", "custom"];
    return (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Select value={preset} onValueChange={(v) => onPreset(v as DatePresetKey)}>
                <SelectTrigger className="h-8 w-36" aria-label="Which days">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>{DATE_PRESET_LABELS[p]}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <TallyDateInput value={from} onValueChange={onFrom} className="h-8 w-36" />
            <span className="text-xs text-muted-foreground">to</span>
            <TallyDateInput value={to} onValueChange={onTo} monthMode="end" className="h-8 w-36" />
            <span className="ml-auto text-xs text-muted-foreground">
                {from === to ? "One day" : `${isoDaysBetween(from, to).length} days`}
            </span>
        </div>
    );
}
