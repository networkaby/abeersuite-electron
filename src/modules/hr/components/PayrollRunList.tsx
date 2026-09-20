"use client";

// HR & People → Payroll. One run a month: generate it, look down the list of
// staff, post it as a single journal voucher. The list here is the history —
// twelve rows a year, so it is read whole and never paged.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HandCoins, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { PAYROLL_STATUS_LABELS, formatPeriodMonth, type PayrollRunRow } from "../lib/payrollTypes";
import NewPayrollRunDialog from "./NewPayrollRunDialog";

export default function PayrollRunList({ canRun }: { canRun: boolean }) {
    const router = useRouter();
    const { data, loading, refreshing, error, reload } = useApiResource<PayrollRunRow[]>("/api/hr/payroll");
    useRealtimeTopics(["ledger", "settings"], reload);
    const [showNew, setShowNew] = useState(false);

    const rows = data ?? [];
    const posted = rows.filter((r) => r.status === "POSTED").length;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Payroll"
                    subtitle={data
                        ? `${rows.length} run${rows.length === 1 ? "" : "s"}, ${posted} posted${refreshing ? " · refreshing…" : ""}`
                        : undefined}
                    icon={<HandCoins size={20} />}
                    actions={canRun ? (
                        <Button type="button" onClick={() => setShowNew(true)}>
                            <Plus size={16} /> New run
                        </Button>
                    ) : null}
                />

                {showNew && (
                    <NewPayrollRunDialog
                        onClose={() => { setShowNew(false); reload(); }}
                        onGenerated={(id) => router.push(`/office/hr/payroll/${id}`)}
                    />
                )}

                <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
                    A run reads every staff member&apos;s salary structure for that month and posts one journal
                    voucher — salary expense debited, each person&apos;s own ledger credited with their net.
                    Paying them afterwards is an ordinary Payment voucher against that ledger.
                </p>

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="rounded-lg border border-border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Month</TableHead>
                                    <TableHead>Posted on</TableHead>
                                    <TableHead className="text-right">Staff</TableHead>
                                    <TableHead className="text-right">Gross</TableHead>
                                    <TableHead className="text-right">Deductions</TableHead>
                                    <TableHead className="text-right">Net payable</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Voucher</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!rows.length && <TableEmptyRow colSpan={8} message="No payroll run yet. Generate this month's to begin." />}
                                {rows.map((r) => (
                                    <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/office/hr/payroll/${r.id}`)}>
                                        <TableCell className="font-medium">{formatPeriodMonth(r.periodMonth)}</TableCell>
                                        <TableCell className="text-muted-foreground">{formatDate(r.postingDate)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{r.headcount}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(r.grossPaise)}</TableCell>
                                        <TableCell className="text-right tabular-nums text-muted-foreground">
                                            {r.deductionsPaise ? formatRupeesFromPaise(r.deductionsPaise) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(r.netPaise)}</TableCell>
                                        <TableCell>
                                            <Badge variant={r.status === "POSTED" ? "default" : r.status === "CANCELLED" ? "destructive" : "secondary"}>
                                                {PAYROLL_STATUS_LABELS[r.status]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            {r.voucherId ? (
                                                <Link
                                                    href={`/vouchers/journal-entries/${r.voucherId}`}
                                                    className="text-sm text-primary underline-offset-2 hover:underline"
                                                >
                                                    {r.voucherRef}
                                                </Link>
                                            ) : <span className="text-sm text-muted-foreground">—</span>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
