"use client";

// HR & People → Payroll → Generate.
//
// Owner, 2026-09-20: "the page where i see per head what is supposed to be the
// total from last payroll to till day", and "right click expand breakup pay
// head etc." So this is a page, not a dialog: it opens on the days nobody has
// been paid for yet — the day after the last run, up to today — and shows what
// each head is owed for exactly those days.
//
// Clicking a row opens the pay-head breakup, the same gesture (and the same
// wording) as VoucherRegisterTable's "click to expand lines". Right-click is
// deliberately left alone: across this app it belongs to LinkContextMenu's
// "Open in new window", and payroll should not be the one screen where it does
// something else.
//
// Nothing here writes until Generate is pressed; the dates can be moved as
// often as you like.

import { Fragment, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/shared/components/Field";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatPeriod, type PayrollLineDto, type PayrollPreview } from "../lib/payrollTypes";

export default function PayrollGenerateTab({ canRun, onGenerated }: {
    canRun: boolean;
    /** Hands the new run's id to the page, which switches to History. */
    onGenerated: (runId: number) => void;
}) {
    // Empty until the server says where the period should start — it knows
    // where the last run finished, and the screen does not.
    const [from, setFrom] = useState<string | null>(null);
    const [to, setTo] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [open, setOpen] = useState<Set<number>>(new Set());
    const [saving, setSaving] = useState(false);

    const qs = [
        from ? `from=${from}` : "",
        to ? `to=${to}` : "",
    ].filter(Boolean).join("&");
    const { data, loading, refreshing, error, reload } = useApiResource<PayrollPreview>(
        `/api/hr/payroll/preview${qs ? `?${qs}` : ""}`,
    );

    // The server's answer is the truth about the period until the user edits it.
    const periodFrom = from ?? data?.periodFrom ?? "";
    const periodTo = to ?? data?.periodTo ?? "";

    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const all = data?.lines ?? [];
        if (!needle) return all;
        return all.filter((l) => `${l.staffName} ${l.staffCode ?? ""}`.toLowerCase().includes(needle));
    }, [data, q]);

    const toggle = (id: number) => setOpen((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const generate = async () => {
        if (!data) return;
        setSaving(true);
        try {
            const res = await axios.post("/api/hr/payroll", {
                periodFrom: data.periodFrom,
                periodTo:   data.periodTo,
            });
            toast.success(`${formatPeriod(data.periodFrom, data.periodTo)} generated — ${data.headcount} staff`);
            onGenerated(res.data.id);
        } catch (e) {
            toast.error(extractApiError(e, "Could not generate the run"));
        } finally {
            setSaving(false);
        }
    };

    const blocked = !!data?.overlapRunId;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
                <Field label="From" hint={
                    data?.startedFrom === "after-last-run" ? "The day after the last payroll."
                        : data?.startedFrom === "first-joining" ? "No payroll has been run before — the earliest joining date."
                            : undefined
                }>
                    {(id) => (
                        <TallyDateInput
                            id={id}
                            value={periodFrom}
                            onValueChange={(v) => { setFrom(v); setOpen(new Set()); }}
                            className="h-9 w-36 text-sm"
                        />
                    )}
                </Field>
                <Field label="Till" hint="Usually today.">
                    {(id) => (
                        <TallyDateInput
                            id={id}
                            value={periodTo}
                            onValueChange={(v) => { setTo(v); setOpen(new Set()); }}
                            className="h-9 w-36 text-sm"
                        />
                    )}
                </Field>
                <Button type="button" variant="outline" size="sm" onClick={reload} disabled={refreshing}>
                    {refreshing ? "Reading…" : "Refresh"}
                </Button>
                <div className="ml-auto flex items-end gap-2">
                    {canRun && (
                        <Button type="button" onClick={generate} disabled={saving || loading || blocked || !data?.headcount}>
                            {saving ? "Generating…" : "Generate this run"}
                        </Button>
                    )}
                </div>
            </div>

            {data && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarRange size={15} />
                    Paying <strong className="text-foreground">{formatPeriod(data.periodFrom, data.periodTo)}</strong>
                    {" — "}every day since the last payroll, proportioned to the days each person was on the staff.
                </p>
            )}

            {blocked && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <span>{data!.overlapLabel} is already covered by another run. Move the From date past it — no day may be paid twice.</span>
                </p>
            )}

            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && (
                <>
                    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                        <Stat label="Staff" value={String(data.headcount)} />
                        <Stat label="Gross" value={formatRupeesFromPaise(data.grossPaise)} />
                        <Stat label="Deductions" value={formatRupeesFromPaise(data.deductionsPaise)} />
                        <Stat label="Net payable" value={formatRupeesFromPaise(data.netPaise)} strong />
                        {!!data.skippedCount && (
                            <Stat label="Not included" value={String(data.skippedCount)} />
                        )}
                    </div>

                    <div className="relative">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search staff"
                            aria-label="Search staff on this run"
                            className="h-9 w-72 pl-8 text-sm"
                        />
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                        <Table className="min-w-max">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8" />
                                    <TableHead>Staff</TableHead>
                                    <TableHead>Days paid</TableHead>
                                    <TableHead className="text-right">A month</TableHead>
                                    <TableHead className="text-right">Gross</TableHead>
                                    <TableHead className="text-right">Deductions</TableHead>
                                    <TableHead className="text-right">Net for this period</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!rows.length && <TableEmptyRow colSpan={7} message="Nobody was on the staff in this period." />}
                                {rows.map((l) => (
                                    <Fragment key={l.id}>
                                        <TableRow
                                            className={`cursor-pointer ${l.included ? "" : "opacity-55"}`}
                                            title="Click to expand the pay heads"
                                            onClick={() => toggle(l.id)}
                                        >
                                            <TableCell className="text-muted-foreground">
                                                {open.has(l.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </TableCell>
                                            <TableCell>
                                                <span className="font-medium">{l.staffName}</span>
                                                {l.staffCode && <span className="ml-2 text-xs text-muted-foreground">{l.staffCode}</span>}
                                                {l.skipReason && <p className="text-xs text-amber-600">{l.skipReason}</p>}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground tabular-nums">
                                                {l.paidDays} of {l.periodDays}
                                            </TableCell>
                                            <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                                                {l.monthlyNetPaise ? formatRupeesFromPaise(l.monthlyNetPaise) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(l.grossPaise)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">
                                                {l.deductionsPaise ? formatRupeesFromPaise(l.deductionsPaise) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(l.netPaise)}</TableCell>
                                        </TableRow>
                                        {open.has(l.id) && <Breakup line={l} />}
                                    </Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}
        </div>
    );
}

/** The pay heads behind one person's figure, already proportioned. */
function Breakup({ line }: { line: PayrollLineDto }) {
    const earnings = line.lines.filter((l) => l.kind === "EARNING");
    const deductions = line.lines.filter((l) => l.kind === "DEDUCTION");
    return (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell />
            <TableCell colSpan={6} className="py-3">
                {!line.lines.length ? (
                    <p className="text-sm text-muted-foreground">
                        {line.skipReason ?? "Nothing to break up for this period."}
                    </p>
                ) : (
                    <div className="max-w-xl space-y-1.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Pay heads for {line.paidDays} of {line.periodDays} days
                            {line.effectiveFrom && ` · structure from ${formatDate(line.effectiveFrom)}`}
                        </p>
                        {earnings.map((h) => (
                            <HeadRow key={`e-${h.name}`} name={h.name} paise={h.amountPaise} />
                        ))}
                        {deductions.map((h) => (
                            <HeadRow key={`d-${h.name}`} name={h.name} paise={-h.amountPaise} muted />
                        ))}
                        <div className="flex justify-between border-t border-border pt-1.5 text-sm font-medium">
                            <span>Net for this period</span>
                            <span className="tabular-nums">{formatRupeesFromPaise(line.netPaise)}</span>
                        </div>
                        {line.ledger && (
                            <p className="pt-1 text-xs text-muted-foreground">
                                Credited to {line.ledger.name}
                                {line.expenseAccount && ` · booked against ${line.expenseAccount.name}`}
                            </p>
                        )}
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
}

function HeadRow({ name, paise, muted }: { name: string; paise: number; muted?: boolean }) {
    return (
        <div className={`flex justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
            <span>{name}</span>
            <span className="tabular-nums">{formatRupeesFromPaise(paise)}</span>
        </div>
    );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={strong ? "text-xl font-semibold tabular-nums" : "text-sm tabular-nums"}>{value}</p>
        </div>
    );
}
