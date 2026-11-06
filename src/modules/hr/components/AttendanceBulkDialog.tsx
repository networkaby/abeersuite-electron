"use client";

// Bulk mark — one status on many people × many days of the month on show.
// The register already knows each person's calendar, so the cells are picked
// here (with the same readDay() the grid paints from) and the server only
// writes them, in one request (POST /api/hr/attendance/bulk).

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, ListChecks, Search } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { CELL } from "../lib/attendanceStyles";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, readDay, holidayDatesFor, weekdayOf } from "../lib/attendanceCalendar";
import type { HolidayDto, RegisterPerson } from "../lib/attendanceTypes";

const CHOICES: (AttendanceStatus | null)[] = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", null];

function Opt({ checked, set, label }: { checked: boolean; set: (v: boolean) => void; label: string }) {
    return (
        <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={(v) => set(v === true)} />
            {label}
        </label>
    );
}

export type BulkCell = { userId: number; date: string };

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    people: RegisterPerson[];
    holidays: HolidayDto[];
    /** The month on show; dates are kept inside it and never past today. */
    monthFrom: string;
    monthTo: string;
    today: string;
    /** Pre-filled day (a click on a column head), else the whole month so far. */
    initialDate: string | null;
    onApply: (cells: BulkCell[], status: AttendanceStatus | null) => Promise<void>;
};

export default function AttendanceBulkDialog({ open, onOpenChange, people, holidays, monthFrom, monthTo, today, initialDate, onApply }: Props) {
    const lastDay = monthTo < today ? monthTo : today;
    // Mounted fresh on every open (the register renders it only while open), so
    // the starting state is simply everyone ticked and the pre-filled dates.
    const [picked, setPicked] = useState<Set<number>>(() => new Set(people.map((p) => p.id)));
    const [from, setFrom] = useState(initialDate ?? monthFrom);
    const [to, setTo] = useState(initialDate ?? lastDay);
    const [status, setStatus] = useState<AttendanceStatus | null>("PRESENT");
    const [skipOff, setSkipOff] = useState(true);
    const [skipHoliday, setSkipHoliday] = useState(true);
    const [skipLeave, setSkipLeave] = useState(true);
    const [onlyEmpty, setOnlyEmpty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState("");

    const clampDate = (v: string) => (v < monthFrom ? monthFrom : v > lastDay ? lastDay : v);

    const cells = useMemo<BulkCell[]>(() => {
        if (!from || !to || from > to) return [];
        const days = isoDaysBetween(from, to);
        const out: BulkCell[] = [];
        for (const p of people) {
            if (!picked.has(p.id)) continue;
            const mine = holidayDatesFor(holidays, p.branchIds);
            for (const iso of days) {
                if (iso > today) continue;
                const r = readDay(p, iso, mine);
                if (r.kind === "outside") continue; // before joining / after leaving
                const m = p.marks[iso];
                // A day the till recorded stays on auto: overriding it is a
                // one-by-one job on the grid, never a bulk one (owner, 2026-11-06).
                if (m?.source === "COUNTER") continue;
                if (onlyEmpty && m) continue;
                if (!m) {
                    if (skipHoliday && mine.has(iso)) continue;
                    if (skipLeave && p.leaveDays[iso]) continue;
                    if (skipOff && p.weeklyOff.includes(weekdayOf(iso))) continue;
                }
                // Auto on a cell with nothing stored does nothing — leave it out.
                if (status === null && !m) continue;
                out.push({ userId: p.id, date: iso });
            }
        }
        return out;
    }, [people, holidays, picked, from, to, today, status, skipOff, skipHoliday, skipLeave, onlyEmpty]);

    const peopleCount = new Set(cells.map((c) => c.userId)).size;
    const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const apply = async () => {
        if (!cells.length) return;
        setSaving(true);
        try {
            await onApply(cells, status);
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    };

    const shown = people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
    const yesterday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const ranges: { label: string; from: string; to: string }[] = [
        ...(today >= monthFrom && today <= monthTo ? [{ label: "Today", from: today, to: today }] : []),
        ...(yesterday >= monthFrom && yesterday <= lastDay ? [{ label: "Yesterday", from: yesterday, to: yesterday }] : []),
        { label: monthTo < today ? "Whole month" : "Month so far", from: monthFrom, to: lastDay },
    ];
    const verb = status ? `Mark ${cells.length} day${cells.length === 1 ? "" : "s"} as ${ATTENDANCE_STATUS_META[status].label}` : `Set ${cells.length} day${cells.length === 1 ? "" : "s"} back to Auto`;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
            <DialogContent className="gap-0 p-0 sm:max-w-3xl">
                <DialogHeader className="border-b border-border px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-base"><ListChecks size={18} /> Bulk mark attendance</DialogTitle>
                    <DialogDescription>Pick the days, the mark and the people. Days the office already marked are replaced. Days the till recorded are never touched here — change those one by one on the grid.</DialogDescription>
                </DialogHeader>

                <div className="grid max-h-[65vh] gap-0 overflow-y-auto md:grid-cols-[1fr_1fr] md:overflow-visible">
                    {/* Left: what and when */}
                    <div className="space-y-5 px-5 py-4 md:border-r md:border-border">
                        <section className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Days</h3>
                            <div className="flex flex-wrap gap-1">
                                {ranges.map((r) => (
                                    <Button key={r.label} type="button" size="sm" variant={from === r.from && to === r.to ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => { setFrom(r.from); setTo(r.to); }}>
                                        {r.label}
                                    </Button>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label htmlFor="bulk-from" className="text-xs">From</Label>
                                    <Input id="bulk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={(e) => setFrom(clampDate(e.target.value || monthFrom))} />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="bulk-to" className="text-xs">To</Label>
                                    <Input id="bulk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} onBlur={(e) => setTo(clampDate(e.target.value || lastDay))} />
                                </div>
                            </div>
                        </section>

                        <section className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Mark as</h3>
                            <div className="grid grid-cols-5 gap-1.5">
                                {CHOICES.map((c) => {
                                    const on = status === c;
                                    return (
                                        <button
                                            key={c ?? "auto"}
                                            title={c ? undefined : "Remove the office mark — till days show the till's answer again"}
                                            type="button"
                                            onClick={() => setStatus(c)}
                                            aria-pressed={on}
                                            className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition ${on ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50"}`}
                                        >
                                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded text-sm font-semibold ${c ? CELL[c] : "border border-dashed border-border text-muted-foreground"}`}>
                                                {c ? ATTENDANCE_STATUS_META[c].short : <Bot size={14} />}
                                            </span>
                                            {c ? ATTENDANCE_STATUS_META[c].label : "Auto"}
                                        </button>
                                    );
                                })}
                            </div>
                            {status === null && <p className="text-xs text-muted-foreground">Auto removes office marks. Days the till recorded show the till&apos;s answer again; other days show the calendar.</p>}
                        </section>

                        <section className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3. Leave these alone</h3>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                <Opt checked={skipOff} set={setSkipOff} label="Weekly off" />
                                <Opt checked={skipHoliday} set={setSkipHoliday} label="Holidays" />
                                <Opt checked={skipLeave} set={setSkipLeave} label="Approved leave" />
                                <Opt checked={onlyEmpty} set={setOnlyEmpty} label="Already marked days" />
                            </div>
                        </section>
                    </div>

                    {/* Right: who */}
                    <section className="flex min-h-0 flex-col gap-2 px-5 py-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">4. Staff · {picked.size} of {people.length}</h3>
                            <div className="flex gap-1">
                                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(new Set(people.map((p) => p.id)))}>All</Button>
                                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(new Set())}>None</Button>
                            </div>
                        </div>
                        <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input placeholder="Search staff" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
                        </div>
                        <div className="max-h-72 min-h-40 flex-1 overflow-y-auto rounded-md border border-border">
                            {shown.length === 0 ? (
                                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No one matches.</p>
                            ) : shown.map((p) => (
                                <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/50">
                                    <Checkbox checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                                    <UserAvatar avatarUrl={p.avatarUrl} name={p.name} role={p.role} sizePx={22} />
                                    <span className="truncate">{p.name}</span>
                                </label>
                            ))}
                        </div>
                    </section>
                </div>

                <DialogFooter className="items-center border-t border-border px-5 py-3 sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                        {cells.length
                            ? <><span className="font-medium text-foreground">{cells.length}</span> day{cells.length === 1 ? "" : "s"} for <span className="font-medium text-foreground">{peopleCount}</span> {peopleCount === 1 ? "person" : "people"}</>
                            : "Nothing to mark with these choices."}
                    </p>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="button" disabled={saving || !cells.length} onClick={() => void apply()}>{saving ? "Saving…" : cells.length ? verb : "Apply"}</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
