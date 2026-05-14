"use client";

import Link from "next/link";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export type TxInvoice = {
    id: number;
    number: string;
    status: string;
    issueDate: string;
    totalAmount: string;
    amountPaid: string;
};

export type TxInvVoucher = {
    id: number;
    reference: string;
    type: string;
    status: string;
    date: string;
    totalAmount: string;
    amountReceived: string;
};

export type CustomerTransactions = { invoices: TxInvoice[]; invVouchers: TxInvVoucher[] };

const INV_VOUCHER_URLS: Record<string, (id: number) => string> = {
    SALE:            (id) => `/office/inventory/sales/${id}`,
    SALE_RETURN:     (id) => `/office/inventory/sales/${id}`,
    PURCHASE:        (id) => `/office/inventory/purchases/${id}`,
    PURCHASE_RETURN: (id) => `/office/inventory/purchases/${id}`,
};

const TX_STATUS_COLORS: Record<string, string> = {
    PAID:      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    POSTED:    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    PARTIAL:   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    SENT:      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    DRAFT:     "bg-muted text-muted-foreground",
    VOID:      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function TransactionsTable({ invoices, invVouchers }: { invoices: TxInvoice[]; invVouchers: TxInvVoucher[] }) {
    type Row = { kind: string; id: number; ref: string; type: string; date: string; total: string; paid: string; status: string; url: string | null };

    const rows: Row[] = [
        ...invoices.map((inv) => ({
            kind: "invoice",
            id: inv.id,
            ref: inv.number,
            type: "Invoice",
            date: inv.issueDate,
            total: inv.totalAmount,
            paid: inv.amountPaid,
            status: inv.status,
            url: `/office/accountancy/invoices/${inv.id}`,
        })),
        ...invVouchers.map((v) => ({
            kind: "voucher",
            id: v.id,
            ref: v.reference,
            type: v.type.split("_").map((w: string) => w[0] + w.slice(1).toLowerCase()).join(" "),
            date: v.date,
            total: v.totalAmount,
            paid: v.amountReceived,
            status: v.status,
            url: INV_VOUCHER_URLS[v.type]?.(v.id) ?? null,
        })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
        <Card>
            <CardContent className="px-0 pt-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Paid</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={`${row.kind}-${row.id}`}>
                                <TableCell className="text-xs text-muted-foreground">{row.type}</TableCell>
                                <TableCell>
                                    {row.url ? (
                                        <Link href={row.url} className="font-mono text-xs text-primary hover:underline">{row.ref}</Link>
                                    ) : (
                                        <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.date)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{formatRupeesFromPaise(Number(row.total) * 100)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{formatRupeesFromPaise(Number(row.paid) * 100)}</TableCell>
                                <TableCell>
                                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TX_STATUS_COLORS[row.status] ?? "bg-muted text-muted-foreground"}`}>
                                        {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
