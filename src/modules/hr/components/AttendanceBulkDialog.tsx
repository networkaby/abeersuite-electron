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
    const [skipTill, setSkipTill] = useState(true);
    const [onlyEmpty, setOnlyEmpty] = useState(false);
    const [saving, setSaving] = useState(false);

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
                if (skipTill && m?.source === "COUNTER") continue;
                if (onlyEmpty && m) continue;
                if (!m) {
                    if (skipHoliday && mine.has(iso)) continue;
                    if (skipLeave && p.leaveDays[iso]) continue;
                    if (skipOff && p.weeklyOff.includes(weekdayOf(iso))) continue;
                }
                // Clearing a cell with nothing stored does nothing — leave it out.
                if (status === null && !m) continue;
                out.push({ userId: p.id, date: iso });
            }
        }
        return out;
    }, [people, holidays, picked, from, to, today, status, skipOff, skipHoliday, skipLeave, skipTill, onlyEmpty]);

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

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Bulk mark attendance</DialogTitle>
                    <DialogDescription>Pick people, days and a mark. Days already marked by the office are overwritten.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="bulk-from">From</Label>
                            <Input id="bulk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={(e) => setFrom(clampDate(e.target.value || monthFrom))} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="bulk-to">To</Label>
                            <Input id="bulk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} onBlur={(e) => setTo(clampDate(e.target.value || lastDay))} />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label>Mark as</Label>
                        <div className="flex flex-wrap gap-1">
                            {CHOICES.map((s) => (
                                <Button key={s ?? "clear"} type="button" size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                                    {s ? ATTENDANCE_STATUS_META[s].label : "Clear mark"}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Opt checked={skipOff} set={setSkipOff} label="Skip weekly off" />
                        <Opt checked={skipHoliday} set={setSkipHoliday} label="Skip holidays" />
                        <Opt checked={skipLeave} set={setSkipLeave} label="Skip approved leave" />
                        <Opt checked={skipTill} set={setSkipTill} label="Skip days the till recorded" />
                        <Opt checked={onlyEmpty} set={setOnlyEmpty} label="Only empty days" />
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <Label>Staff ({picked.size} of {people.length})</Label>
                            <div className="flex gap-1">
                                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set(people.map((p) => p.id)))}>Select all</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                            </div>
                        </div>
                        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                            {people.map((p) => (
                                <label key={p.id} className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                                    {p.name}
                                </label>
                            ))}
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                        {cells.length
                            ? `This will ${status ? `mark ${cells.length} day${cells.length === 1 ? "" : "s"} as ${ATTENDANCE_STATUS_META[status].label}` : `clear ${cells.length} day${cells.length === 1 ? "" : "s"}`} for ${peopleCount} ${peopleCount === 1 ? "person" : "people"}.`
                            : "Nothing to mark with these choices."}
                    </p>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" disabled={saving || !cells.length} onClick={() => void apply()}>{saving ? "Saving…" : "Apply"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
