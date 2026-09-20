"use client";

// Job tab — staff ID, joining date, employment type, weekly off, the expense
// ledger their salary hits, and leaving. Every field saves on blur (Pattern D):
// the PATCH is partial, so each box is its own write and its own tick.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { LogOut, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/shared/components/Field";
import { FieldSaveMark } from "@/shared/components/FieldSaveMark";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useFieldSave, useGlAccounts } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from "@/shared/lib/schemas/hrSchema";
import type { StaffDetail } from "../lib/staffTypes";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    const [expenseAccountId, setExpenseAccountId] = useState<number | null>(profile?.expenseAccountId ?? null);
    const [leaveOpen, setLeaveOpen] = useState(false);

    const { accounts } = useGlAccounts();
    const expenseOptions = useMemo(
        () => accounts
            .filter((a) => a.group?.type === "EXPENSE")
            .map((a) => ({ value: a.id, label: a.name, leaf: a.group?.name ?? undefined })),
        [accounts],
    );

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

                <Field label="Salary expense ledger" hint="Where their salary is booked as an expense. Blank = the org's Salary & Wages.">
                    {(id) => (
                        <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1">
                                <SearchableSelect
                                    value={expenseAccountId}
                                    options={expenseOptions}
                                    placeholder="Salary & Wages (default)"
                                    ariaLabel="Salary expense ledger"
                                    triggerClassName="h-9 w-full text-sm"
                                    onChange={(v) => {
                                        const original = expenseAccountId;
                                        setExpenseAccountId(v);
                                        void save({
                                            key: "expenseAccountId",
                                            original: original == null ? "" : String(original),
                                            next: v == null ? "" : String(v),
                                            write: (val) => patch({ expenseAccountId: val ? Number(val) : null }),
                                            revert: (val) => setExpenseAccountId(val ? Number(val) : null),
                                            label: "Salary expense ledger",
                                            onSaved: onChanged,
                                        });
                                    }}
                                />
                            </div>
                            <FieldSaveMark state={stateOf("expenseAccountId")} className="sr-only" />
                            <span id={id} className="sr-only">Salary expense ledger</span>
                        </div>
                    )}
                </Field>

                <div className="sm:col-span-2">
                    <Field label="Weekly off" hint="The attendance register (a later release) treats these days as paid days off.">
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
