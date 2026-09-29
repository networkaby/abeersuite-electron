"use client";

// Job tab — staff ID, joining date, employment type, weekly off, their own
// salary ledger, and leaving. Every field saves on blur (Pattern D):
// the PATCH is partial, so each box is its own write and its own tick.

import { useEffect, useState, type ChangeEvent } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { toast } from "sonner";
import { LogOut, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/shared/components/Field";
import { FieldSaveMark } from "@/shared/components/FieldSaveMark";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useFieldSave } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { staffLedgerStanding } from "@/shared/lib/hr/staffLedgerStanding";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { clampNumber, parseDecimalInput, parseDigitsInput } from "@/shared/lib/format/parseNumericInput";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { dutyHoursFor, dutyMinutesFor, formatWorked } from "@/shared/lib/hr/dutyTime";
import { DEFAULT_IDLE_LIMIT_MINUTES } from "@/shared/lib/constants/session";
import { SHOP_SEASONAL_FALLBACK, type SeasonalHours } from "@/shared/lib/hr/seasonalHours";
import { getSeasonalHours } from "@/shared/lib/orgDefaults";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from "@/shared/lib/schemas/hrSchema";
import type { StaffDetail } from "../lib/staffTypes";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// House rule: no `<input type="number">`. These two boxes save on blur and are
// uncontrolled, so instead of the shared NumericInput they keep the browser out
// the same way by hand — sanitise each keystroke, clamp once focus leaves.
const numberBox = (mode: "digits" | "decimal", min: number, max: number) => ({
    type: "text" as const,
    inputMode: (mode === "digits" ? "numeric" : "decimal") as "numeric" | "decimal",
    autoComplete: "off",
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
        e.target.value = mode === "digits" ? parseDigitsInput(e.target.value) : parseDecimalInput(e.target.value);
    },
    /** The blur value, sanitised and pulled inside the bounds. "" stays "" —
     *  blank means "use the default", not zero. */
    settle: (raw: string) => {
        const cleaned = (mode === "digits" ? parseDigitsInput(raw) : parseDecimalInput(raw)).replace(/\.$/, "");
        if (!cleaned) return "";
        const n = Number(cleaned);
        return Number.isFinite(n) ? String(clampNumber(n, min, max)) : "";
    },
});

const HOURS_BOX = numberBox("decimal", 0.5, 24);
const IDLE_BOX = numberBox("digits", 5, 360);

export default function StaffJobTab({ url, detail, canEdit, onChanged }: {
    url: string;
    detail: StaffDetail;
    canEdit: boolean;
    onChanged: () => void;
}) {
    const { profile, user } = detail;
    const { save, stateOf } = useFieldSave();
    const patch = (body: Record<string, unknown>) => axios.patch(url, body);

    // Controlled copies of the non-text controls; the text boxes are uncontrolled
    // and read straight off the DOM on blur, as the pattern prescribes.
    const [joinedOn, setJoinedOn] = useState(profile?.joinedOn ?? "");
    const [employmentType, setEmploymentType] = useState(profile?.employmentType ?? "FULL_TIME");
    const [weeklyOff, setWeeklyOff] = useState<number[]>(profile?.weeklyOff ?? [0]);
    const [leaveOpen, setLeaveOpen] = useState(false);
    // Kept in state only so the "= a N-hour day" line under the boxes follows the
    // typing. The boxes themselves stay uncontrolled, as the pattern prescribes.
    const [dutyStart, setDutyStart] = useState(profile?.dutyStart ?? "");
    const [dutyEnd, setDutyEnd] = useState(profile?.dutyEnd ?? "");
    const [dutyMinutes, setDutyMinutes] = useState<number | null>(profile?.dutyMinutes ?? null);

    // The shop's hours, so a blank pair of boxes can say what it actually falls
    // back to TODAY rather than quoting a constant. Seasonal, so the answer moves
    // with the year — and with it the "= a N-hour day" line, because a winter day
    // really is shorter when the shop opens later and closes at the same time.
    const [shopHours, setShopHours] = useState<SeasonalHours>(SHOP_SEASONAL_FALLBACK);
    useEffect(() => {
        let alive = true;
        void getSeasonalHours()
            .then((h) => { if (alive) setShopHours(h); })
            .catch(() => { /* the fallback is already in state */ });
        return () => { alive = false; };
    }, []);

    const shopToday = dutyHoursFor(null, null, { seasonal: shopHours });
    const effective = dutyHoursFor(dutyStart, dutyEnd, { seasonal: shopHours });
    const dutyDay = dutyMinutesFor(dutyMinutes, effective.start, effective.end);

    const left = staffHasLeft(profile);
    const disabled = !canEdit;

    const saveDays = (next: number[]) => {
        const original = JSON.stringify(weeklyOff);
        setWeeklyOff(next);
        void save({
            key: "weeklyOff",
            original,
            next: JSON.stringify(next),
            write: () => patch({ weeklyOff: next }),
            revert: () => setWeeklyOff(JSON.parse(original) as number[]),
            label: "Weekly off",
            onSaved: onChanged,
        });
    };

    return (
        <div className="max-w-3xl space-y-6">
            {!profile && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    No HR record yet. Saving any field below starts one — and opens {user.name.split(" ")[0]}&apos;s own ledger under
                    &ldquo;Salary Payable&rdquo;, where salary and advances will be booked.
                </p>
            )}

            <fieldset disabled={disabled} className="grid gap-4 border-0 p-0 sm:grid-cols-2">
                <Field label="Staff ID" hint="Free text — EMP-001, or whatever the shop uses. Must be unique.">
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <Input
                                id={id}
                                defaultValue={profile?.staffCode ?? ""}
                                placeholder="EMP-001"
                                className="h-9 text-sm"
                                onBlur={(e) => void save({
                                    key: "staffCode",
                                    original: profile?.staffCode ?? "",
                                    next: e.target.value.trim(),
                                    write: (v) => patch({ staffCode: v || null }),
                                    revert: (v) => { e.target.value = v; },
                                    label: "Staff ID",
                                    onSaved: onChanged,
                                })}
                            />
                            <FieldSaveMark state={stateOf("staffCode")} />
                        </div>
                    )}
                </Field>

                <Field label="Joined on">
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <TallyDateInput
                                id={id}
                                value={joinedOn}
                                className="h-9 text-sm"
                                onValueChange={(iso) => {
                                    const original = joinedOn;
                                    setJoinedOn(iso);
                                    void save({
                                        key: "joinedOn",
                                        original,
                                        next: iso,
                                        write: (v) => patch({ joinedOn: v || null }),
                                        revert: (v) => setJoinedOn(v),
                                        label: "Joining date",
                                        onSaved: onChanged,
                                    });
                                }}
                            />
                            <FieldSaveMark state={stateOf("joinedOn")} />
                        </div>
                    )}
                </Field>

                <Field label="Employment type">
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <Select
                                value={employmentType}
                                onValueChange={(v) => {
                                    const original = employmentType;
                                    setEmploymentType(v);
                                    void save({
                                        key: "employmentType",
                                        original,
                                        next: v,
                                        write: (val) => patch({ employmentType: val }),
                                        revert: (val) => setEmploymentType(val),
                                        label: "Employment type",
                                        onSaved: onChanged,
                                    });
                                }}
                            >
                                <SelectTrigger id={id} className="h-9 w-full text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {EMPLOYMENT_TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FieldSaveMark state={stateOf("employmentType")} />
                        </div>
                    )}
                </Field>

                {/* Their own ledger, shown rather than chosen. It is a LIABILITY — what
                    the shop owes them — and HR opens it with the profile, so there is
                    nothing to pick. Salary EXPENSE is one org-wide ledger held on the
                    payroll run (owner, 2026-09-20: "exp account is common to all"),
                    which is why no expense field belongs on a person's page. */}
                <Field label="Their salary ledger" hint="Salary accrues into this account; advances and payments go out of it.">
                    {(id) => (
                        <div id={id} className="flex h-9 items-center gap-2 text-sm">
                            {detail.ledger ? (
                                <>
                                    <GatedLink whenLocked="text" textClassName="font-medium"
                                        href={`/office/accountancy/masters/ledgers/${detail.ledger.id}`}
                                        className="font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                        {detail.ledger.name}
                                    </GatedLink>
                                    <span className="text-muted-foreground">
                                        — {staffLedgerStanding(detail.ledger.balance, formatInr).sentence}
                                    </span>
                                </>
                            ) : (
                                <span className="text-muted-foreground">
                                    Opens the first time anything here is saved.
                                </span>
                            )}
                        </div>
                    )}
                </Field>

                <Field label="Office hours" hint={`When duty starts and ends. Arriving more than 15 minutes after the start counts as late. Blank = the shop's own hours, ${shopToday.start}–${shopToday.end} today${shopHours.summerStart !== shopHours.winterStart ? ", which move with the season" : ""}.`}>
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <Input
                                id={id}
                                type="time"
                                defaultValue={profile?.dutyStart ?? ""}
                                className="h-9 w-28 text-sm"
                                onBlur={(e) => { setDutyStart(e.target.value); void save({
                                    key: "dutyStart",
                                    original: profile?.dutyStart ?? "",
                                    next: e.target.value,
                                    write: (v) => patch({ dutyStart: v || null }),
                                    revert: (v) => { e.target.value = v; setDutyStart(v); },
                                    label: "Start",
                                    onSaved: onChanged,
                                }); }}
                            />
                            <span className="text-sm text-muted-foreground">to</span>
                            <Input
                                type="time"
                                aria-label="Office closing time"
                                defaultValue={profile?.dutyEnd ?? ""}
                                className="h-9 w-28 text-sm"
                                onBlur={(e) => { setDutyEnd(e.target.value); void save({
                                    key: "dutyEnd",
                                    original: profile?.dutyEnd ?? "",
                                    next: e.target.value,
                                    write: (v) => patch({ dutyEnd: v || null }),
                                    revert: (v) => { e.target.value = v; setDutyEnd(v); },
                                    label: "Close",
                                    onSaved: onChanged,
                                }); }}
                            />
                            <FieldSaveMark state={stateOf("dutyStart")} />
                            <FieldSaveMark state={stateOf("dutyEnd")} />
                        </div>
                    )}
                </Field>

                <Field label="Standard office hours" hint="The duty a full day is counted against — work beyond it is overtime. Leave blank and a full day is simply the office hours. Set it only when part of the day is an unpaid break.">
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <Input
                                id={id}
                                type={HOURS_BOX.type}
                                inputMode={HOURS_BOX.inputMode}
                                autoComplete={HOURS_BOX.autoComplete}
                                onChange={HOURS_BOX.onChange}
                                placeholder={String(+(dutyMinutesFor(null, effective.start, effective.end) / 60).toFixed(2))}
                                defaultValue={profile?.dutyMinutes ? String(+(profile.dutyMinutes / 60).toFixed(2)) : ""}
                                className="h-9 w-24 text-sm"
                                onBlur={(e) => { const v = HOURS_BOX.settle(e.target.value); e.target.value = v; void save({
                                    key: "dutyMinutes",
                                    original: profile?.dutyMinutes ? String(+(profile.dutyMinutes / 60).toFixed(2)) : "",
                                    next: v,
                                    // Typed in hours because nobody thinks in minutes; stored in
                                    // minutes because a 7.5-hour day is not a whole number of them.
                                    write: (h) => { const mins = h ? Math.round(Number(h) * 60) : null; setDutyMinutes(mins); return patch({ dutyMinutes: mins }); },
                                    revert: (h) => { e.target.value = h; setDutyMinutes(h ? Math.round(Number(h) * 60) : null); },
                                    label: "Standard office hours",
                                    onSaved: onChanged,
                                }); }}
                            />
                            <span className="text-sm text-muted-foreground">hours</span>
                            <FieldSaveMark state={stateOf("dutyMinutes")} />
                        </div>
                    )}
                </Field>

                <Field label="Signed out after" hint={`Minutes away from the app before this person is signed out — and the gap stops counting as duty. A counter hand needs a short one, a technician a long one. Blank = ${DEFAULT_IDLE_LIMIT_MINUTES}.`}>
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <Input
                                id={id}
                                type={IDLE_BOX.type}
                                inputMode={IDLE_BOX.inputMode}
                                autoComplete={IDLE_BOX.autoComplete}
                                onChange={IDLE_BOX.onChange}
                                placeholder={String(DEFAULT_IDLE_LIMIT_MINUTES)}
                                defaultValue={profile?.idleLimitMinutes ?? ""}
                                className="h-9 w-24 text-sm"
                                onBlur={(e) => { const v = IDLE_BOX.settle(e.target.value); e.target.value = v; void save({
                                    key: "idleLimitMinutes",
                                    original: profile?.idleLimitMinutes ? String(profile.idleLimitMinutes) : "",
                                    next: v,
                                    write: (m) => patch({ idleLimitMinutes: m ? Number(m) : null }),
                                    revert: (m) => { e.target.value = m; },
                                    label: "Signed out after",
                                    onSaved: onChanged,
                                }); }}
                            />
                            <span className="text-sm text-muted-foreground">minutes idle</span>
                            <FieldSaveMark state={stateOf("idleLimitMinutes")} />
                        </div>
                    )}
                </Field>

                <div className="sm:col-span-2 -mt-2 text-xs text-muted-foreground">
                    A full day is <strong>{formatWorked(dutyDay)}</strong>. Below 75% of that the register
                    calls the day half, and below 40% absent — counted from time actually worked, with idle
                    stretches left out. A mark made here on the register always overrules it.
                </div>

                <div className="sm:col-span-2">
                    <Field label="Weekly off" hint="The attendance register reads these days as paid days off, and an hour worked on one is paid at the weekly-off rate.">
                        {(id) => (
                            <div id={id} role="group" aria-label="Weekly off days" className="flex flex-wrap items-center gap-1">
                                {DAYS.map((d, i) => {
                                    const on = weeklyOff.includes(i);
                                    return (
                                        <Button
                                            key={d}
                                            type="button"
                                            size="sm"
                                            variant={on ? "default" : "outline"}
                                            aria-pressed={on}
                                            onClick={() => saveDays(on ? weeklyOff.filter((x) => x !== i) : [...weeklyOff, i].sort((a, b) => a - b))}
                                        >
                                            {d}
                                        </Button>
                                    );
                                })}
                                <FieldSaveMark state={stateOf("weeklyOff")} />
                            </div>
                        )}
                    </Field>
                </div>
            </fieldset>

            {/* ── Leaving ─────────────────────────────────────────────────── */}
            <div className="rounded-lg border border-border p-4">
                {left ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium">Left on {profile?.leftOn ? formatDate(profile.leftOn) : "—"}</p>
                            <p className="text-xs text-muted-foreground">
                                {profile?.leftReason || "No reason recorded."} Sign-in is refused; the seats were vacated.
                            </p>
                        </div>
                        {canEdit && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                    const ok = await confirmAction({
                                        title: `${user.name} has rejoined?`,
                                        body: "Sign-in works again from now. Seats are not restored — appoint them on the Positions page.",
                                        confirmLabel: "Rejoined",
                                        destructive: false,
                                    });
                                    if (!ok) return;
                                    try {
                                        await patch({ leftOn: null, leftReason: null });
                                        toast.success(`${user.name} is back on the staff list`);
                                        onChanged();
                                    } catch (e) {
                                        toast.error(extractApiError(e, "Could not update the record"));
                                    }
                                }}
                            >
                                <Undo2 size={14} /> Rejoined
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium">Leaving</p>
                            <p className="text-xs text-muted-foreground">
                                {profile?.leftOn
                                    ? `Marked to leave on ${formatDate(profile.leftOn)} — sign-in stops that day.`
                                    : "Marking someone as left refuses their sign-in from that date, vacates their seats and signs out every open session. The record stays."}
                            </p>
                        </div>
                        {canEdit && (
                            <Button type="button" size="sm" variant="outline" onClick={() => setLeaveOpen(true)}>
                                <LogOut size={14} /> Mark as left
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {leaveOpen && (
                <MarkLeftDialog
                    name={user.name}
                    seatCount={user.positions.length}
                    onClose={() => setLeaveOpen(false)}
                    onConfirm={async (leftOn, leftReason) => {
                        try {
                            const { data } = await axios.patch<{ vacatedSeats: number }>(url, { leftOn, leftReason: leftReason || null });
                            toast.success(
                                data.vacatedSeats > 0
                                    ? `${user.name} marked as left — ${data.vacatedSeats} seat${data.vacatedSeats === 1 ? "" : "s"} vacated, sessions signed out`
                                    : `${user.name} marked as left`,
                            );
                            setLeaveOpen(false);
                            onChanged();
                        } catch (e) {
                            toast.error(extractApiError(e, "Could not mark as left"));
                        }
                    }}
                />
            )}

            {!canEdit && (
                <p className="text-xs text-muted-foreground">You can read this record but not change it — that needs the HR staff-record grant.</p>
            )}
        </div>
    );
}

function MarkLeftDialog({ name, seatCount, onClose, onConfirm }: {
    name: string;
    seatCount: number;
    onClose: () => void;
    onConfirm: (leftOn: string, reason: string) => Promise<void>;
}) {
    const [leftOn, setLeftOn] = useState(todayIso());
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const future = leftOn > todayIso();
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Mark {name} as left</DialogTitle>
                    <DialogDescription>
                        No sign-in from the date below. {seatCount > 0 ? `Their ${seatCount} seat${seatCount === 1 ? "" : "s"} ${future ? "stay until then" : "are vacated now"}` : "They hold no seat"}; every open session is signed out{future ? " on that day" : ""}. The HR record and the books stay.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <Field label="Last day">
                        {(id) => <TallyDateInput id={id} value={leftOn} onValueChange={setLeftOn} className="h-9 text-sm" />}
                    </Field>
                    <Field label="Reason (optional)">
                        {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Resigned, contract ended…" className="h-9 text-sm" />}
                    </Field>
                    {future && (
                        <p className="text-xs text-muted-foreground">A future date only blocks sign-in from that day. Set today or earlier to vacate the seats now.</p>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={busy || !leftOn}
                        onClick={async () => { setBusy(true); try { await onConfirm(leftOn, reason.trim()); } finally { setBusy(false); } }}
                    >
                        {busy ? "Saving…" : "Mark as left"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
