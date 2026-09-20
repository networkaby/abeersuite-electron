"use client";

// One payroll run, staff-wise. A draft can be trimmed — untick anyone whose
// salary you are holding back this month — and then posted as a single journal
// voucher. Once posted the sheet is read-only: the books own it from then on,
// and a correction is a journal in Accountancy, not an edit here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, HandCoins, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { PAYROLL_STATUS_LABELS, formatPeriodMonth, type PayrollRunDetail } from "../lib/payrollTypes";

export default function PayrollRunWorkspace({ runId, canRun }: { runId: number; canRun: boolean }) {
    const router = useRouter();
    const url = `/api/hr/payroll/${runId}`;
    const { data, loading, refreshing, error, reload } = useApiResource<PayrollRunDetail>(url);
    useRealtimeTopics(["ledger"], reload);

    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(false);

    const isDraft = data?.status === "DRAFT";
    const editable = canRun && isDraft;

    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const all = data?.lines ?? [];
        if (!needle) return all;
        return all.filter((l) => `${l.staffName} ${l.staffCode ?? ""}`.toLowerCase().includes(needle));
    }, [data, q]);

    const skipped = (data?.lines ?? []).filter((l) => l.skipReason);

    /** Tick / untick one person. The server recomputes the run's totals. */
    const toggle = async (lineId: number, include: boolean) => {
        setBusy(true);
        try {
            await axios.patch(url, include ? { include: [lineId] } : { exclude: [lineId] });
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not change the line"));
        } finally {
            setBusy(false);
        }
    };

    const post = async () => {
        if (!data) return;
        const ok = await confirmAction({
            title: `Post ${formatPeriodMonth(data.periodMonth)} to the books?`,
            body: `One journal voucher dated ${formatDate(data.postingDate)}: ${formatRupeesFromPaise(data.netPaise)} credited across ${data.headcount} staff ledgers, and the same amount debited to salary expense. A posted run cannot be edited here.`,
            confirmLabel: "Post the journal",
        });
        if (!ok) return;
        setBusy(true);
        try {
            const res = await axios.post(`${url}/post`);
            toast.success(`Posted as ${res.data.voucherRef}`);
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not post the run"));
        } finally {
            setBusy(false);
        }
    };

    const discard = async () => {
        if (!data) return;
        const ok = await confirmAction({
            title: `Delete the draft for ${formatPeriodMonth(data.periodMonth)}?`,
            body: "Nothing has been posted, so nothing in the books changes. You can generate the month again afterwards.",
            confirmLabel: "Delete draft",
        });
        if (!ok) return;
        try {
            await axios.delete(url);
            toast.success("Draft deleted");
            router.push("/office/hr/payroll");
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the draft"));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title={data ? `Payroll — ${formatPeriodMonth(data.periodMonth)}` : "Payroll"}
                    subtitle={data
                        ? `${data.headcount} staff · dated ${formatDate(data.postingDate)}${refreshing ? " · refreshing…" : ""}`
                        : undefined}
                    icon={<HandCoins size={20} />}
                    actions={data ? (
                        <div className="flex items-center gap-2">
                            <Badge variant={data.status === "POSTED" ? "default" : data.status === "CANCELLED" ? "destructive" : "secondary"}>
                                {PAYROLL_STATUS_LABELS[data.status]}
                            </Badge>
                            {data.voucherId && (
                                <Button asChild size="sm" variant="outline">
                                    <Link href={`/vouchers/journal-entries/${data.voucherId}`}>
                                        <BookOpen size={14} /> {data.voucherRef}
                                    </Link>
                                </Button>
                            )}
                            {editable && (
                                <>
                                    <Button type="button" size="sm" variant="outline" onClick={discard} disabled={busy}>
                                        <Trash2 size={14} /> Delete draft
                                    </Button>
                                    <Button type="button" size="sm" onClick={post} disabled={busy || !data.headcount}>
                                        Post to books
                                    </Button>
                                </>
                            )}
                        </div>
                    ) : null}
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <>
                        <div className="mb-3 flex flex-wrap gap-5 rounded-lg border border-border bg-muted/30 px-4 py-3">
                            <Stat label="Staff paid" value={String(data.headcount)} />
                            <Stat label="Gross" value={formatRupeesFromPaise(data.grossPaise)} />
                            <Stat label="Deductions" value={formatRupeesFromPaise(data.deductionsPaise)} />
                            <Stat label="Net payable" value={formatRupeesFromPaise(data.netPaise)} strong />
                            {data.postedBy && <Stat label="Posted by" value={data.postedBy} />}
                        </div>

                        {!!skipped.length && (
                            <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                                <span>
                                    {skipped.length} {skipped.length === 1 ? "person" : "people"} could not be included. Fix the
                                    reason on their profile, delete this draft and generate the month again.
                                </span>
                            </p>
                        )}

                        <div className="mb-3 relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <Input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Search staff on this run"
                                aria-label="Search staff on this run"
                                className="h-9 w-72 pl-8 text-sm"
                            />
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                            <Table className="min-w-max">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10">{editable ? "Pay" : ""}</TableHead>
                                        <TableHead>Staff</TableHead>
                                        <TableHead>Structure from</TableHead>
                                        <TableHead className="text-right">Gross</TableHead>
                                        <TableHead className="text-right">Deductions</TableHead>
                                        <TableHead className="text-right">Net</TableHead>
                                        <TableHead>Credited to</TableHead>
                                        <TableHead>Salary expense</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!rows.length && <TableEmptyRow colSpan={8} message="Nobody matches that search." />}
                                    {rows.map((l) => (
                                        <TableRow key={l.id} className={l.included ? "" : "opacity-55"}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={l.included}
                                                    disabled={!editable || busy || !!l.skipReason}
                                                    onCheckedChange={(v) => toggle(l.id, v === true)}
                                                    aria-label={`Pay ${l.staffName} this month`}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Link href={`/office/hr/staff/${l.userId}`} className="font-medium hover:underline">
                                                    {l.staffName}
                                                </Link>
                                                {l.staffCode && <span className="ml-2 text-xs text-muted-foreground">{l.staffCode}</span>}
                                                {l.skipReason && <p className="text-xs text-amber-600">{l.skipReason}</p>}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {l.effectiveFrom ? formatDate(l.effectiveFrom) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(l.grossPaise)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">
                                                {l.deductionsPaise ? formatRupeesFromPaise(l.deductionsPaise) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(l.netPaise)}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{l.ledger?.name ?? "—"}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{l.expenseAccount?.name ?? "—"}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </div>
        </ScrollArea>
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
