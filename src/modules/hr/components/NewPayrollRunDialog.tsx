"use client";

// New payroll run. Pick the month and the screen fetches what it WOULD pay —
// staff-wise, straight from each person's salary structure. Nothing is written
// until Generate, so you can look at a month as often as you like.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/shared/components/Field";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatPeriodMonth, type PayrollPreview } from "../lib/payrollTypes";

export default function NewPayrollRunDialog({ onClose, onGenerated }: {
    onClose: () => void;
    onGenerated: (runId: number) => void;
}) {
    // The month you are in — salary is accrued at the end of the month you are
    // finishing, so that is the one the dialog opens on.
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const [saving, setSaving] = useState(false);

    const { data, loading, error, reload } = useApiResource<PayrollPreview>(
        /^\d{4}-\d{2}$/.test(month) ? `/api/hr/payroll/preview?month=${month}` : null,
    );

    const included = useMemo(() => (data?.lines ?? []).filter((l) => l.included), [data]);
    const skipped = useMemo(() => (data?.lines ?? []).filter((l) => !l.included), [data]);
    const blocked = !!data?.existingRunId;

    const generate = async () => {
        setSaving(true);
        try {
            const res = await axios.post("/api/hr/payroll", { periodMonth: month });
            toast.success(`${formatPeriodMonth(`${month}-01`)} generated — ${res.data.headcount} staff`);
            onGenerated(res.data.id);
        } catch (e) {
            toast.error(extractApiError(e, "Could not generate the run"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>New payroll run</DialogTitle>
                    <DialogDescription>
                        Every current staff member, at the salary in force at the end of the month. Nothing is
                        posted yet — the run lands as a draft you can check.
                    </DialogDescription>
                </DialogHeader>

                <Field label="Month">
                    {(id) => (
                        <Input
                            id={id}
                            type="month"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="h-9 w-48 text-sm"
                        />
                    )}
                </Field>

                {blocked && (
                    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                        <span>
                            {formatPeriodMonth(`${month}-01`)} already has a {data!.existingStatus?.toLowerCase()} run.{" "}
                            <button type="button" className="underline" onClick={() => onGenerated(data!.existingRunId!)}>
                                Open it
                            </button>{" "}
                            instead of generating a second one.
                        </span>
                    </p>
                )}

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <>
                            <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                                <Stat label="Staff" value={String(data.headcount)} />
                                <Stat label="Gross" value={formatRupeesFromPaise(data.grossPaise)} />
                                <Stat label="Deductions" value={formatRupeesFromPaise(data.deductionsPaise)} />
                                <Stat label="Net payable" value={formatRupeesFromPaise(data.netPaise)} strong />
                            </div>

                            <ScrollArea className="max-h-72 rounded-lg border border-border" type="always">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Staff</TableHead>
                                            <TableHead className="text-right">Gross</TableHead>
                                            <TableHead className="text-right">Deductions</TableHead>
                                            <TableHead className="text-right">Net</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {included.map((l) => (
                                            <TableRow key={l.id}>
                                                <TableCell>
                                                    {l.staffName}
                                                    {l.staffCode && <span className="ml-2 text-xs text-muted-foreground">{l.staffCode}</span>}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(l.grossPaise)}</TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                                    {l.deductionsPaise ? formatRupeesFromPaise(l.deductionsPaise) : "—"}
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(l.netPaise)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {skipped.map((l) => (
                                            <TableRow key={l.id} className="opacity-60">
                                                <TableCell>{l.staffName}</TableCell>
                                                <TableCell colSpan={3} className="text-right text-xs text-amber-600">{l.skipReason}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>

                            {!!skipped.length && (
                                <p className="text-xs text-muted-foreground">
                                    {skipped.length} {skipped.length === 1 ? "person is" : "people are"} not included — fix the
                                    reason on their profile and generate again, or leave them and pay them separately.
                                </p>
                            )}
                    </>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={generate} disabled={saving || loading || blocked || !data?.headcount}>
                        {saving ? "Generating…" : `Generate ${data ? formatPeriodMonth(data.periodMonth) : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={strong ? "text-lg font-semibold tabular-nums" : "tabular-nums"}>{value}</p>
        </div>
    );
}
