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
//
// The whole skeleton is on screen from the first paint — toolbar, the line
// that says what is being paid, the totals, the search and the table — and
// only the VALUES arrive later. Nothing is mounted or unmounted by the fetch,
// so the page cannot jump under the pointer while you are reaching for a
// date field. That is also why neither date carries a `hint`: a hint under
// one field and not the other makes the two inputs sit at different heights,
// and a hint that appears only once the server answers moves them again.
// Where the From date came from is said in the sentence below instead.

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

    // Said in one always-present line rather than as a hint under the From
    // field, so the toolbar is the same height before and after the fetch.
    const startedNote = data?.startedFrom === "after-last-run"
        ? "From is the day after the last payroll."
        : data?.startedFrom === "first-joining"
            ? "No payroll has been run before, so From is the earliest joining date."
            : "";

    const money = (paise: number | undefined) => (data ? formatRupeesFromPaise(paise ?? 0) : "—");

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
                <Field label="From">
                    {(id) => (
                        <TallyDateInput
                            id={id}
                            value={periodFrom}
                            onValueChange={(v) => { setFrom(v); setOpen(new Set()); }}
                            className="h-9 w-36 text-sm"
                        />
                    )}
                </Field>
                <Field label="Till">
                    {(id) => (
                        <TallyDateInput
                            id={id}
                            value={periodTo}
                            onValueChange={(v) => { setTo(v); setOpen(new Set()); }}
                            className="h-9 w-36 text-sm"
                        />
                    )}
                </Field>
                {/* Fixed width, so "Reading…" does not make the button breathe. */}
                <Button type="button" variant="outline" size="sm" className="w-24" onClick={reload} disabled={refreshing}>
                    {refreshing ? "Reading…" : "Refresh"}
                </Button>
                {canRun && (
                    <Button
                        type="button"
                        className="ml-auto w-44"
                        onClick={generate}
                        disabled={saving || loading || blocked || !data?.headcount}
                    >
                        {saving ? "Generating…" : "Generate this run"}
                    </Button>
                )}
            </div>

            {/* Always on screen — two lines' worth of room, held whether or not
                there is anything to say yet. */}
            <p className="flex min-h-10 items-start gap-2 text-sm text-muted-foreground">
                <CalendarRange size={15} className="mt-0.5 shrink-0" />
                <span>
                    {data ? (
                        <>
                            Paying <strong className="text-foreground">{formatPeriod(data.periodFrom, data.periodTo)}</strong>
                            {" — "}proportioned to the days each person was on the staff.{startedNote && ` ${startedNote}`}
                        </>
                    ) : "Reading what is owed since the last payroll…"}
                </span>
            </p>

            {blocked && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <span>{data!.overlapLabel} is already covered by another run. Move the From date past it — no day may be paid twice.</span>
                </p>
            )}

            {/* Errors only. The spinner is deliberately not used here: swapping a
                centred spinner for the table is the biggest jump on the page. */}
            {error && <QueryStateBlock loading={false} error={error} hasData={!!data} onRetry={reload} />}

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <Stat label="Staff" value={data ? String(data.headcount) : "—"} />
                <Stat label="Gross" value={money(data?.grossPaise)} />
                <Stat label="Deductions" value={money(data?.deductionsPaise)} />
                <Stat label="Net payable" value={money(data?.netPaise)} strong />
                <Stat label="Not included" value={data ? String(data.skippedCount) : "—"} />
            </div>

            <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search staff"
                    aria-label="Search staff on this run"
                    disabled={!data}
                    className="h-9 w-72 pl-8 text-sm"
                />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                {/* No `min-w-max`: this sits inside a ScrollArea whose viewport hides
                    horizontal overflow, so a table sized to its own content pushes the
                    page wider than the visible area and the excess is simply clipped —
                    63px of the Staff Directory was unreachable that way. The wrapper's
                    own overflow-x-auto is what scrolls if the columns ever need it. */}
                <Table>
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
                                {!data && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                                            Reading…
                                        </TableCell>
                                    </TableRow>
                                )}
                                {data && !rows.length && (
                                    <TableEmptyRow colSpan={7} message="Nobody was on the staff in this period." />
                                )}
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
