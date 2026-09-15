"use client";

import Link from "next/link";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { referenceHref, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export type TxInvVoucher = {
    /** Unique across sources — a bill's detail id and a receipt's spine id live
     *  in different id spaces and would otherwise collide. */
    rowKey: string;
    id: number;
    /** Which register this row belongs to, so the 3-dot menu and the reference
     *  link open the right form (bills are "inv", receipts / notes are "gl"). */
    source: VoucherSource;
    reference: string;
    type: string;
    status: string;
    date: string;
    totalAmount: string;
    amountPaid: string;
    /** What this row does to the running balance, signed onto the party's
     *  normal side — read off their own ledger legs by the server. Not derived
     *  from total − paid: a cash bill is fully paid and moves nothing, while a
     *  receipt has no bill total at all. */
    movement: string;
    branch:    { name: string };
    createdBy: { name: string };
};

// `TxInvoice` and the parallel Invoice array were retired with the
// Invoice → InvVoucher consolidation (Layer 3b, 2026-05-24). Callers
// now pass a single `invVouchers` list.
export type CustomerTransactions = { invVouchers: TxInvVoucher[] };

const TX_STATUS_COLORS: Record<string, string> = {
    POSTED:    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    DRAFT:     "bg-muted text-muted-foreground",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function TransactionsTable({ invVouchers, onChanged }: { invVouchers: TxInvVoucher[]; onChanged?: () => void }) {
    type Row = {
        rowKey:     string;
        id:         number;
        source:     VoucherSource;
        ref:        string;
        type:       string;
        kind:       string;
        date:       string;
        total:      number;
        paid:       number;
        movement:   number;
        status:     string;
        url:        string | null;
        branchName: string | null;
        createdBy:  string | null;
        balance:    number; // running balance — set in second pass below
        isOpening:  boolean;
    };

    const formatType = (type: string) =>
        type === "OPENING"
            ? "Opening"
            : type.split("_").map((w: string) => w[0] + w.slice(1).toLowerCase()).join(" ");

    // Build raw rows (balance will be filled below)
    const rawRows: Omit<Row, "balance">[] = invVouchers.map((v) => ({
        rowKey:     v.rowKey,
        id:         v.id,
        source:     v.source,
        ref:        v.reference,
        type:       formatType(v.type),
        kind:       v.type,
        date:       v.date,
        total:      Number(v.totalAmount),
        paid:       Number(v.amountPaid),
        movement:   Number(v.movement),
        status:     v.status,
        url:        v.type === "OPENING" ? null : referenceHref(v.source, v.id, v.type),
        branchName: v.branch.name || null,
        createdBy:  v.createdBy.name || null,
        isOpening:  v.type === "OPENING",
    }));

    // Running balance: sort chronologically (oldest first), accumulate each
    // row's own ledger movement, then attach to each row. The movement comes
    // from the server (the party's GL legs) — a cash bill is settled at the
    // counter and moves nothing, a receipt brings the balance down.
    const ascending = [...rawRows].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    let runningBalance = 0;
    const balanceMap = new Map<string, number>();
    for (const r of ascending) {
        runningBalance += r.movement;
        balanceMap.set(r.rowKey, runningBalance);
    }

    // Display newest first
    const rows: Row[] = rawRows
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((r) => ({ ...r, balance: balanceMap.get(r.rowKey) ?? 0 }));

    const money = (n: number) => formatRupeesFromPaise(Math.round(n * 100));

    return (
        <Card className="py-0 overflow-hidden">
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-muted-foreground/70 font-normal">Branch</TableHead>
                            <TableHead className="text-muted-foreground/70 font-normal">Created by</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Paid</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-10" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.rowKey} className={row.isOpening ? "bg-muted/30" : undefined}>
                                <TableCell className="text-xs text-muted-foreground">{row.type}</TableCell>
                                <TableCell>
                                    {row.url ? (
                                        <Link href={row.url} className="font-mono text-xs text-primary hover:underline">{row.ref}</Link>
                                    ) : (
                                        <span className={`font-mono text-xs ${row.isOpening ? "text-muted-foreground" : "text-muted-foreground"}`}>{row.ref}</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.date)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{row.branchName ?? <span className="opacity-40">—</span>}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{row.createdBy ?? <span className="opacity-40">—</span>}</TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                    {/* A receipt has no bill total, and neither does an
                                        opening credit — dash rather than a hollow ₹0.00. */}
                                    {row.total === 0 ? <span className="opacity-40">—</span> : money(row.total)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                    {row.paid === 0 && (row.isOpening || row.source !== "inv")
                                        ? <span className="opacity-40">—</span>
                                        : money(row.paid)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                                    {money(row.balance)}
                                </TableCell>
                                <TableCell>
                                    {row.isOpening ? (
                                        <span className="opacity-40 text-xs">—</span>
                                    ) : (
                                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TX_STATUS_COLORS[row.status] ?? "bg-muted text-muted-foreground"}`}>
                                            {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    {!row.isOpening && (
                                        <DayBookActionsMenu
                                            rawId={row.id}
                                            source={row.source}
                                            kind={row.kind}
                                            reference={row.ref}
                                            onChanged={onChanged}
                                        />
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
