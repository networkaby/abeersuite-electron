"use client";

// HR & People → Payroll. Two tabs, as the owner asked for: Generate is the
// working sheet — per head, what is owed from the last payroll up to today —
// and once a run is generated the page switches to History, which is the list
// of runs already made.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert, WalletMinimal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import {
    PAYROLL_STATUS_LABELS,
    PAYROLL_VOUCHER_STATE_LABELS,
    formatPeriod,
    voucherIsBroken,
    type PayrollRunRow,
} from "../lib/payrollTypes";
import PayrollGenerateTab from "./PayrollGenerateTab";
import PayrollPayTab from "./PayrollPayTab";

const TABS = ["generate", "pay", "history"] as const;
type Tab = (typeof TABS)[number];

export default function PayrollRunList({ canRun }: { canRun: boolean }) {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>("generate");
    const { data, loading, refreshing, error, reload } = useApiResource<PayrollRunRow[]>("/api/hr/payroll");
    useRealtimeTopics(["ledger", "settings"], reload);

    const rows = data ?? [];
    // Counted on the voucher, not on the run's own word: a run whose journal
    // has been cancelled or deleted is not posted, whatever it says about
    // itself, and the subtitle must not claim it is.
    const posted = rows.filter((r) => r.status === "POSTED" && r.voucherState === "LIVE").length;
    const broken = rows.filter((r) => voucherIsBroken(r.status, r.voucherState)).length;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Payroll"
                    // Never undefined: a subtitle that arrives with the data
                    // pushes the whole page down by its own height once the
                    // fetch lands. It says "…" until it can say a number.
                    subtitle={data
                        ? `${rows.length} run${rows.length === 1 ? "" : "s"}, ${posted} posted${refreshing ? " · refreshing…" : ""}`
                        : "Reading the runs…"}
                    icon={<WalletMinimal size={20} />}
                />

                <ModuleTabs module="hr" tabs={TABS} active={tab} onChange={setTab} className="mt-2 rounded-t-lg border border-b-0" />
                <div className="rounded-b-lg border border-border bg-card p-5">
                    {tab === "generate" && (
                        <PayrollGenerateTab
                            canRun={canRun}
                            // A generated run is a draft to be checked, so the page
                            // moves to History and opens it.
                            onGenerated={(id) => { setTab("history"); reload(); router.push(`/office/hr/payroll/${id}`); }}
                        />
                    )}

                    {/* Settling what the runs accrued. Its own tab because paying
                        is a different act from generating, and happens on a
                        different day. */}
                    {tab === "pay" && <PayrollPayTab canPay={canRun} onPaid={reload} />}

                    {tab === "history" && (
                        <>
                            <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
                                Every run made so far. Posting one writes a single journal voucher — salary expense
                                debited, each person&apos;s own ledger credited with their net. Paying them afterwards
                                is an ordinary Payment voucher against that ledger.
                            </p>

                            {!!broken && (
                                <p className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                                    <span>
                                        {broken === 1 ? "One run says" : `${broken} runs say`} posted, but the journal behind
                                        {broken === 1 ? " it is" : " them is"} no longer standing — cancelled or deleted in
                                        Accountancy, so the books carry nothing for it. Open the run and cancel it, then
                                        generate that period again.
                                    </span>
                                </p>
                            )}

                            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                            {data && (
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    {/* No `min-w-max`: this sits inside a ScrollArea whose viewport hides
                                        horizontal overflow, so a table sized to its own content pushes the
                                        page wider than the visible area and the excess is simply clipped —
                                        63px of the Staff Directory was unreachable that way. The wrapper's
                                        own overflow-x-auto is what scrolls if the columns ever need it. */}
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Period</TableHead>
                                                <TableHead>Dated</TableHead>
                                                <TableHead className="text-right">Staff</TableHead>
                                                <TableHead className="text-right">Gross</TableHead>
                                                <TableHead className="text-right">Deductions</TableHead>
                                                <TableHead className="text-right">Net payable</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Voucher</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {!rows.length && <TableEmptyRow colSpan={8} message="No run yet. Generate one on the Generate tab." />}
                                            {rows.map((r) => (
                                                <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/office/hr/payroll/${r.id}`)}>
                                                    <TableCell className="font-medium">{formatPeriod(r.periodFrom, r.periodTo)}</TableCell>
                                                    <TableCell className="text-muted-foreground">{formatDate(r.postingDate)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{r.headcount}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(r.grossPaise)}</TableCell>
                                                    <TableCell className="text-right tabular-nums text-muted-foreground">
                                                        {r.deductionsPaise ? formatRupeesFromPaise(r.deductionsPaise) : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(r.netPaise)}</TableCell>
                                                    <TableCell>
                                                        {voucherIsBroken(r.status, r.voucherState) ? (
                                                            // "Posted" on its own reads as done, and it is not: the
                                                            // journal behind it is gone. The badge says so here, where
                                                            // the eye already goes for the answer.
                                                            <Badge variant="destructive" className="gap-1">
                                                                <TriangleAlert size={12} />
                                                                No voucher
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant={r.status === "POSTED" ? "default" : r.status === "CANCELLED" ? "destructive" : "secondary"}>
                                                                {PAYROLL_STATUS_LABELS[r.status]}
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                                        {r.voucherId ? (
                                                            <span className="flex items-center gap-1.5">
                                                                <Link
                                                                    href={`/vouchers/journal-entries/${r.voucherId}`}
                                                                    className="text-sm text-primary underline-offset-2 hover:underline"
                                                                >
                                                                    {r.voucherRef}
                                                                </Link>
                                                                {/* Still there, but no longer counting — say which,
                                                                    right beside its number. */}
                                                                {PAYROLL_VOUCHER_STATE_LABELS[r.voucherState] && (
                                                                    <span className="text-xs text-destructive">
                                                                        {PAYROLL_VOUCHER_STATE_LABELS[r.voucherState]}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : r.voucherRef ? (
                                                            // The pointer broke when the voucher was deleted. The
                                                            // number it carried survives, struck through, so the run
                                                            // can still be traced through the audit log.
                                                            <span className="flex items-center gap-1.5">
                                                                <span className="text-sm text-muted-foreground line-through">{r.voucherRef}</span>
                                                                <span className="text-xs text-destructive">removed</span>
                                                            </span>
                                                        ) : <span className="text-sm text-muted-foreground">—</span>}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </ScrollArea>
    );
}
