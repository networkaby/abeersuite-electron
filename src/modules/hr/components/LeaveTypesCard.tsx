"use client";

// Leave types — the kinds of leave, and how many days each one allows in a year.
//
// Owner, 2026-09-22, asked how many leave of each type there are and where to set
// them. Until now the four kinds were a hardcoded list with no limit on any of
// them, so Casual and Earned differed only by the word in the Kind column. This is
// where the numbers live now. It sits on Calendar & Hours beside the holiday list,
// because both are shop-wide HR calendar settings under the same grant.
//
// Going over a quota never blocks. The apply box warns, HR still decides, and the
// days past the quota are the ones payroll should treat as unpaid.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarRange } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NumericInput } from "@/shared/components/NumericInput";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { leaveYearOf } from "@/shared/lib/hr/leaveTypeDefaults";
import { todayIso } from "@/shared/lib/format/formatDate";
import type { LeaveTypeDto } from "../lib/leaveTypes";

/** An empty box means "no limit", which the API stores as null. */
const toCount = (text: string): number | null => (text.trim() === "" ? null : Number(text));
const toText = (n: number | null) => (n === null ? "" : String(n));

type Field = "yearlyQuota";

export default function LeaveTypesCard({ canEdit }: { canEdit: boolean }) {
    const { data, loading, error, reload } = useApiResource<LeaveTypeDto[]>("/api/hr/leave-types", { topics: ["settings"] });

    // The server's answer is the truth; `edits` is only what has been typed over
    // it since. Held this way rather than copied into state, so a box being typed
    // in does not jump under the hand when the list refreshes — and so there is no
    // effect syncing one piece of state into another.
    const [edits, setEdits] = useState<Record<number, Partial<LeaveTypeDto>>>({});
    const rows = useMemo(
        () => (data ?? []).map((t) => ({ ...t, ...edits[t.id] })),
        [data, edits],
    );

    const year = useMemo(() => leaveYearOf(todayIso()), []);

    /** Drop an edit, so the row falls back to what the server last said. */
    const forget = (id: number, field: keyof LeaveTypeDto) =>
        setEdits((prev) => {
            const mine = { ...prev[id] };
            delete mine[field];
            return { ...prev, [id]: mine };
        });

    // Typing only moves the local row. Nothing is sent until the box is left —
    // a PUT per keystroke would be two writes to spell "12".
    const type = (id: number, field: Field, text: string) =>
        setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: toCount(text) } }));

    const commit = async (id: number, field: Field) => {
        const server = data?.find((r) => r.id === id);
        const row = rows.find((r) => r.id === id);
        if (!server || !row || row[field] === server[field]) return;
        try {
            await axios.put("/api/hr/leave-types", { id, [field]: row[field] });
        } catch (e) {
            forget(id, field);
            toast.error(extractApiError(e, "Could not save the leave type"));
        }
    };

    const togglePaid = async (row: LeaveTypeDto, paid: boolean) => {
        setEdits((prev) => ({ ...prev, [row.id]: { ...prev[row.id], paid } }));
        try {
            await axios.put("/api/hr/leave-types", { id: row.id, paid });
        } catch (e) {
            forget(row.id, "paid");
            toast.error(extractApiError(e, "Could not save the leave type"));
        }
    };

    return (
        <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                    <CalendarRange size={15} /> Leave types
                </h2>
                <span className="text-xs text-muted-foreground">Leave year {year.label} · 1 April to 31 March</span>
            </div>

            <QueryStateBlock loading={loading} error={error} hasData={rows.length > 0} onRetry={reload} />

            {rows.length > 0 && (
                <>
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Kind</TableHead>
                                    <TableHead className="w-44">Days a year</TableHead>
                                    <TableHead className="w-24">Paid</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((t) => (
                                    <TableRow key={t.id}>
                                        <TableCell className="font-medium">{t.name}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <NumericInput
                                                    value={toText(t.yearlyQuota)}
                                                    onValueChange={(v) => type(t.id, "yearlyQuota", v)}
                                                    onBlur={() => void commit(t.id, "yearlyQuota")}
                                                    min={0}
                                                    max={365}
                                                    disabled={!canEdit}
                                                    placeholder="No limit"
                                                    aria-label={`Days of ${t.name} leave a year`}
                                                    className="h-8 w-24 text-sm"
                                                />
                                                {t.yearlyQuota === null && (
                                                    <span className="text-xs text-muted-foreground">no limit</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={t.paid}
                                                disabled={!canEdit}
                                                onCheckedChange={(v) => void togglePaid(t, v)}
                                                aria-label={`${t.name} leave is paid`}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Leave the days box empty for a kind that has no limit. Going past a quota does not stop
                        anyone — the person is warned, HR still decides, and the days past the quota are unpaid.
                    </p>
                </>
            )}
        </section>
    );
}
