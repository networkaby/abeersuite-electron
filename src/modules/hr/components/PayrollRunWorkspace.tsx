"use client";

// One payroll run, staff-wise. A draft can be trimmed — untick anyone whose
// salary you are holding back this period — and then posted as a single journal
// voucher. Once posted the sheet is read-only: the books own it from then on,
// and a correction is a journal in Accountancy, not an edit here.
//
// Clicking a row opens that person's pay heads, the same gesture as the
// Generate tab and as VoucherRegisterTable. A posted run keeps the breakup it
// was posted with, because the lines were frozen when it was generated.
//
// Two ways out, and they are not the same thing. A DRAFT is deleted — it never
// reached the books. A POSTED run is CANCELLED: its journal is reversed and the
// days it claimed are freed, so the period can be generated again once whatever
// was wrong is fixed. A posted run is never edited in place.

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Ban, BookOpen, ChevronDown, ChevronRight, Search, Trash2, WalletMinimal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { PAYROLL_STATUS_LABELS, formatPeriod, type PayrollRunDetail } from "../lib/payrollTypes";

export default function PayrollRunWorkspace({ runId, canRun }: { runId: number; canRun: boolean }) {
    const router = useRouter();
    const url = `/api/hr/payroll/${runId}`;
    const { data, loading, refreshing, error, reload } = useApiResource<PayrollRunDetail>(url);
    useRealtimeTopics(["ledger"], reload);

    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<Set<number>>(new Set());
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState("");

    const toggleOpen = (id: number) => setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

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
            title: `Post ${formatPeriod(data.periodFrom, data.periodTo)} to the books?`,
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

    /** Take a posted run back out of the books; the days become free again. */
    const cancelRun = async () => {
        setBusy(true);
        try {
            await axios.post(`${url}/cancel`, { reason: cancelReason.trim() });
            toast.success("Run cancelled and its journal reversed");
            setCancelOpen(false);
            setCancelReason("");
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not cancel the run"));
        } finally {
            setBusy(false);
        }
    };

    const discard = async () => {
        if (!data) return;
        const ok = await confirmAction({
            title: `Delete the draft for ${formatPeriod(data.periodFrom, data.periodTo)}?`,
            body: "Nothing has been posted, so nothing in the books changes. Those days become free to run again.",
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
                    title={data ? `Payroll — ${formatPeriod(data.periodFrom, data.periodTo)}` : "Payroll"}
                    // Never undefined — see PayrollRunList: a subtitle that
                    // appears with the data shifts the page under the pointer.
                    subtitle={data
                        ? `${data.headcount} staff · dated ${formatDate(data.postingDate)}${refreshing ? " · refreshing…" : ""}`
                        : "Reading the run…"}
                    // Back first, then the wallet: this page is only ever
                    // reached from the run list, and there is no other way out.
                    icon={(
                        <div className="flex items-center gap-2">
                            <Link
                                href="/office/hr/payroll"
                                aria-label="Back to payroll"
                                title="Back to payroll"
                                className="hover:text-foreground"
                            >
                                <ArrowLeft size={18} />
                            </Link>
                            <WalletMinimal size={20} />
                        </div>
                    )}
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
                            {canRun && data.status === "POSTED" && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                                    onClick={() => setCancelOpen(true)}
                                    disabled={busy}
                                >
                                    <Ban size={14} /> Cancel run
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
                            {/* No `min-w-max`: this sits inside a ScrollArea whose viewport hides
                                horizontal overflow, so a table sized to its own content pushes the
                                page wider than the visible area and the excess is simply clipped —
                                63px of the Staff Directory was unreachable that way. The wrapper's
                                own overflow-x-auto is what scrolls if the columns ever need it. */}
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10">{editable ? "Pay" : ""}</TableHead>
                                        <TableHead className="w-8" />
                                        <TableHead>Staff</TableHead>
                                        <TableHead>Days paid</TableHead>
                                        <TableHead className="text-right">Gross</TableHead>
                                        <TableHead className="text-right">Deductions</TableHead>
                                        <TableHead className="text-right">Net</TableHead>
                                        <TableHead>Credited to</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!rows.length && <TableEmptyRow colSpan={8} message="Nobody matches that search." />}
                                    {rows.map((l) => (
                                        <Fragment key={l.id}>
                                        <TableRow className={l.included ? "" : "opacity-55"}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={l.included}
                                                    disabled={!editable || busy || !!l.skipReason}
                                                    onCheckedChange={(v) => toggle(l.id, v === true)}
                                                    aria-label={`Pay ${l.staffName} for this period`}
                                                />
                                            </TableCell>
                                            <TableCell
                                                className="cursor-pointer text-muted-foreground"
                                                title="Click to expand the pay heads"
                                                onClick={() => toggleOpen(l.id)}
                                            >
                                                {open.has(l.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </TableCell>
                                            <TableCell>
                                                <Link href={`/office/hr/staff/${l.userId}`} className="font-medium hover:underline">
                                                    {l.staffName}
                                                </Link>
                                                {l.staffCode && <span className="ml-2 text-xs text-muted-foreground">{l.staffCode}</span>}
                                                {l.skipReason && <p className="text-xs text-amber-600">{l.skipReason}</p>}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground tabular-nums">
                                                {l.paidDays} of {l.periodDays}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(l.grossPaise)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">
                                                {l.deductionsPaise ? formatRupeesFromPaise(l.deductionsPaise) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(l.netPaise)}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{l.ledger?.name ?? "—"}</TableCell>
                                        </TableRow>
                                        {open.has(l.id) && (
                                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                <TableCell colSpan={2} />
                                                <TableCell colSpan={6} className="py-3">
                                                    {!l.lines.length ? (
                                                        <p className="text-sm text-muted-foreground">{l.skipReason ?? "Nothing to break up."}</p>
                                                    ) : (
                                                        <div className="max-w-xl space-y-1.5">
                                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                Pay heads for {l.paidDays} of {l.periodDays} days
                                                                {l.effectiveFrom && ` \u00b7 structure from ${formatDate(l.effectiveFrom)}`}
                                                            </p>
                                                            {l.lines.map((h) => (
                                                                <div
                                                                    key={`${h.kind}-${h.name}`}
                                                                    className={`flex justify-between text-sm ${h.kind === "DEDUCTION" ? "text-muted-foreground" : ""}`}
                                                                >
                                                                    <span>{h.name}</span>
                                                                    <span className="tabular-nums">
                                                                        {formatRupeesFromPaise(h.kind === "DEDUCTION" ? -h.amountPaise : h.amountPaise)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-medium">
                                                                <span>Net for this period</span>
                                                                <span className="tabular-nums">{formatRupeesFromPaise(l.netPaise)}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        </Fragment>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </div>

            {/* The reason is required and kept: a cancelled run has to say why,
                the same as cancelling any other voucher in this app. */}
            <Dialog open={cancelOpen} onOpenChange={(o) => { if (!o) setCancelOpen(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Cancel {data ? formatPeriod(data.periodFrom, data.periodTo) : "this run"}?
                        </DialogTitle>
                        <DialogDescription>
                            {data?.voucherRef ?? "The journal"} is reversed and struck through — it stays visible
                            for audit but counts for nothing. These days become free, so the period can be
                            generated again.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="payroll-cancel-reason">Reason</Label>
                        <Textarea
                            id="payroll-cancel-reason"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            rows={3}
                            placeholder="Why is this run being cancelled?"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={!cancelReason.trim() || busy}
                            onClick={cancelRun}
                        >
                            Cancel the run
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
