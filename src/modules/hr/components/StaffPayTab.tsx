"use client";

// Pay tab — the salary structure as dated revisions. The one in force today is
// the card; the table is the history. Nothing here pays anyone: a later payroll
// run reads these rows and posts the month.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { salaryTotals } from "../lib/salaryLines";
import type { StaffDetail, StaffSalaryDto } from "../lib/staffTypes";
import SalaryRevisionDialog from "./SalaryRevisionDialog";

export default function StaffPayTab({ url, detail, canEdit, onChanged }: {
    url: string;
    detail: StaffDetail;
    canEdit: boolean;
    onChanged: () => void;
}) {
    const [open, setOpen] = useState(false);
    const salaries = detail.salaries; // newest first
    const today = todayIso();
    const current = salaries.find((s) => s.effectiveFrom <= today) ?? null;

    const remove = async (s: StaffSalaryDto) => {
        const ok = await confirmAction({
            title: `Delete the revision from ${formatDate(s.effectiveFrom)}?`,
            body: `Net ${formatRupeesFromPaise(s.netPaise)} a month. The earlier revision, if any, applies from that date again.`,
            confirmLabel: "Delete revision",
        });
        if (!ok) return;
        try {
            await axios.delete(`${url}/salary/${s.id}`);
            toast.success("Revision deleted");
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the revision"));
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                {current ? <CurrentCard s={current} /> : (
                    <p className="text-sm text-muted-foreground">
                        {salaries.length ? "No revision has started yet — the first one is dated in the future." : "No salary structure entered yet."}
                    </p>
                )}
                {canEdit && (
                    <Button type="button" onClick={() => setOpen(true)}>
                        <Plus size={16} /> New revision
                    </Button>
                )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>From</TableHead>
                            <TableHead>Lines</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Deductions</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead>Note</TableHead>
                            {canEdit && <TableHead className="w-12" />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {salaries.length === 0 ? (
                            <TableEmptyRow colSpan={canEdit ? 7 : 6} message="No revisions yet." />
                        ) : salaries.map((s) => {
                            const t = salaryTotals(s.lines);
                            return (
                                <TableRow key={s.id} className={s.id === current?.id ? "bg-muted/40" : undefined}>
                                    <TableCell className="whitespace-nowrap">
                                        {formatDate(s.effectiveFrom)}
                                        {s.id === current?.id && <span className="ml-2 text-xs text-muted-foreground">current</span>}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {s.lines.map((l) => `${l.name} ${l.kind === "DEDUCTION" ? "−" : ""}${formatRupeesFromPaise(l.amountPaise)}`).join(" · ")}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(s.grossPaise)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{t.deductionsPaise ? formatRupeesFromPaise(t.deductionsPaise) : "—"}</TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(s.netPaise)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{s.note ?? ""}</TableCell>
                                    {canEdit && (
                                        <TableCell>
                                            <Button type="button" variant="ghost" size="icon-sm" title="Delete revision" aria-label="Delete revision" onClick={() => void remove(s)}>
                                                <Trash2 size={14} />
                                            </Button>
                                        </TableCell>
                                    )}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {open && (
                <SalaryRevisionDialog
                    url={url}
                    startFrom={current}
                    onClose={() => setOpen(false)}
                    onSaved={() => { setOpen(false); onChanged(); }}
                />
            )}
        </div>
    );
}

function CurrentCard({ s }: { s: StaffSalaryDto }) {
    const t = salaryTotals(s.lines);
    return (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current structure · from {formatDate(s.effectiveFrom)}</p>
            <div className="mt-1 flex flex-wrap gap-6">
                <Stat label="Gross" value={formatRupeesFromPaise(t.grossPaise)} />
                <Stat label="Deductions" value={t.deductionsPaise ? formatRupeesFromPaise(t.deductionsPaise) : "—"} />
                <Stat label="Net a month" value={formatRupeesFromPaise(t.netPaise)} strong />
            </div>
        </div>
    );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`tabular-nums ${strong ? "text-lg font-semibold" : "text-base"}`}>{value}</p>
        </div>
    );
}
