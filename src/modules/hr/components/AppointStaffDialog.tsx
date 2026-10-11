"use client";

// Appoint — the joining, the seat and the first pay structure in one step.
//
// Owner, 2026-09-20: a joining is created WITH the pay structure, and the seat
// is given here too. Typing a joining date on one tab and a salary on another
// let a person exist half-hired; this dialog makes the three one act.
//
// It is a shortcut, not a gate: every field it writes can still be edited on
// its own tab afterwards. Three separate writes in order — the profile (which
// also opens the person's ledger), then the seat, then the salary revision. A
// later step failing leaves the earlier ones standing and says so, because
// re-running the dialog is safer than silently unwinding a ledger.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/shared/components/Field";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import { positionScopeLabel } from "@/shared/lib/org/positionScope";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, type EmploymentType } from "@/shared/lib/schemas/hrSchema";
import { DEFAULT_SALARY_LINES, salaryTotals, type SalaryLine } from "../lib/salaryLines";
import PayDaysField from "./PayDaysField";
import { DEFAULT_PAY_DAYS } from "@/shared/lib/constants/hr";
import type { StaffDetail } from "../lib/staffTypes";

interface PositionRow {
    id: string;
    title: string;
    branch: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
}

type Draft = { name: string; kind: SalaryLine["kind"]; amount: string };

export default function AppointStaffDialog({ detail, canAppointSeat, onClose, onDone }: {
    detail: StaffDetail;
    /** positions:edit — without it the seat row is not offered. */
    canAppointSeat: boolean;
    onClose: () => void;
    onDone: () => void;
}) {
    const { user, profile } = detail;
    const url = `/api/hr/staff/${user.id}`;

    const [joinedOn, setJoinedOn] = useState(profile?.joinedOn ?? todayIso());
    const [employmentType, setEmploymentType] = useState<EmploymentType>(
        (profile?.employmentType as EmploymentType) ?? "FULL_TIME",
    );
    const [staffCode, setStaffCode] = useState(profile?.staffCode ?? detail.nextStaffCode ?? "");
    const [positionId, setPositionId] = useState<string | null>(null);
    const [lines, setLines] = useState<Draft[]>(() =>
        DEFAULT_SALARY_LINES.map((l) => ({ name: l.name, kind: l.kind, amount: "" })),
    );
    const [payDays, setPayDays] = useState(String(DEFAULT_PAY_DAYS));
    const [saving, setSaving] = useState(false);

    const { data: positions } = useApiResource<PositionRow[]>(canAppointSeat ? "/api/positions" : null);
    const held = new Set(user.positions.map((p) => p.id));
    const positionOptions = useMemo(
        () => (positions ?? [])
            .filter((p) => !held.has(p.id))
            .map((p) => ({
                value: p.id,
                label: `${p.title} · ${positionScopeLabel(p, { withDepartment: true })}`,
                leaf:  p.title,
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [positions, user.positions],
    );

    const parsed = useMemo<SalaryLine[]>(
        () => lines.map((l) => ({ name: l.name.trim(), kind: l.kind, amountPaise: parseRupeesToPaise(l.amount) ?? 0 })),
        [lines],
    );
    const totals = salaryTotals(parsed);
    const badLine = lines.some((l) => !l.name.trim() || (l.amount.trim() !== "" && parseRupeesToPaise(l.amount) == null));
    const days = Number(payDays);
    const badDays = !Number.isInteger(days) || days < 1 || days > 31;
    const canSave = !saving && !badLine && !badDays && !!joinedOn && totals.grossPaise > 0;

    const set = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const submit = async () => {
        setSaving(true);
        try {
            // 1. The joining. This first save also opens their Salary Payable ledger.
            await axios.patch(url, {
                joinedOn,
                employmentType,
                staffCode: staffCode.trim() || null,
            });

            // 2. The seat, when one was picked. A clash here is worth saying out
            //    loud, but the joining above is already saved and stays.
            if (positionId) {
                try {
                    await axios.post(`/api/positions/${positionId}/holders`, { userId: user.id });
                } catch (e) {
                    toast.error(extractApiError(e, "Joined, but the seat could not be given"));
                }
            }

            // 3. The first salary structure, dated from the joining day.
            await axios.post(`${url}/salary`, {
                effectiveFrom: joinedOn,
                payDays: days,
                lines: parsed,
                note: "On appointment",
            });

            toast.success(`${user.name.split(" ")[0]} appointed — ${formatRupeesFromPaise(totals.netPaise)} a month`);
            onDone();
        } catch (e) {
            toast.error(extractApiError(e, "Could not complete the appointment"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Appoint {user.name}</DialogTitle>
                    <DialogDescription>
                        The joining date, the seat and the first salary structure together. Each one can still be
                        changed on its own tab afterwards.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Joined on" required>
                        {(id) => <TallyDateInput id={id} value={joinedOn} onValueChange={setJoinedOn} className="h-9 text-sm" />}
                    </Field>

                    <Field label="Employment type">
                        {() => (
                            <SearchableSelect
                                value={employmentType}
                                options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }))}
                                onChange={(v) => v && setEmploymentType(v as EmploymentType)}
                                clearable={false}
                                ariaLabel="Employment type"
                                triggerClassName="h-9 text-sm"
                            />
                        )}
                    </Field>

                    <Field label="Staff ID" hint="Auto-generated (starts from EMP-786) — edit only if your shop uses a custom ID.">
                        {(id) => (
                            <Input
                                id={id}
                                value={staffCode}
                                onChange={(e) => setStaffCode(e.target.value)}
                                placeholder={detail.nextStaffCode ?? "EMP-786"}
                                className="h-9 text-sm font-mono"
                            />
                        )}
                    </Field>

                    {canAppointSeat && (
                        <Field label="Seat" hint="A position that already exists in Administration.">
                            {() => (
                                <SearchableSelect
                                    value={positionId}
                                    options={positionOptions}
                                    onChange={(v) => setPositionId(v ? String(v) : null)}
                                    placeholder="— none for now —"
                                    ariaLabel="Seat"
                                    triggerClassName="h-9 text-sm"
                                />
                            )}
                        </Field>
                    )}
                </div>

                <div className="space-y-2">
                    <p className="text-sm font-medium">Salary structure</p>
                    <PayDaysField value={payDays} onChange={setPayDays} grossPaise={totals.grossPaise} />
                    {lines.map((l, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <Input
                                value={l.name}
                                onChange={(e) => set(i, { name: e.target.value })}
                                placeholder="Basic"
                                aria-label={`Line ${i + 1} name`}
                                className="h-9 flex-1 text-sm"
                            />
                            <SearchableSelect
                                value={l.kind}
                                options={[{ value: "EARNING", label: "Earning" }, { value: "DEDUCTION", label: "Deduction" }]}
                                onChange={(v) => v && set(i, { kind: v as SalaryLine["kind"] })}
                                clearable={false}
                                ariaLabel={`Line ${i + 1} kind`}
                                triggerClassName="h-9 w-32 text-sm"
                            />
                            <Input
                                value={l.amount}
                                onChange={(e) => set(i, { amount: e.target.value })}
                                placeholder="0"
                                inputMode="decimal"
                                aria-label={`Line ${i + 1} amount`}
                                className="h-9 w-32 text-right text-sm tabular-nums"
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                                disabled={lines.length === 1}
                                aria-label={`Remove line ${i + 1}`}
                            >
                                <X size={14} />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setLines((ls) => [...ls, { name: "", kind: "EARNING", amount: "" }])}
                    >
                        <Plus size={14} /> Add a line
                    </Button>
                    <p className="text-sm text-muted-foreground">
                        Gross {formatRupeesFromPaise(totals.grossPaise)} · Deductions {formatRupeesFromPaise(totals.deductionsPaise)} ·{" "}
                        <span className="font-medium text-foreground">Net {formatRupeesFromPaise(totals.netPaise)}</span> a month
                    </p>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={submit} disabled={!canSave}>
                        {saving ? "Appointing…" : "Appoint"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
