"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { referenceHref, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { BillLinkDialog, clearBillLinkCache } from "@/modules/accountancy/components/BillLinkDialog";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

/** Whether this voucher has been matched off against the other side, bill by
 *  bill. Not the voucher's lifecycle — only POSTED vouchers are listed at all. */
export type SettlementState = "SETTLED" | "PARTIAL" | "DUE";

export type TxInvVoucher = {
    /** Unique across sources — a bill's detail id and a receipt's spine id live
     *  in different id spaces and would otherwise collide. */
    rowKey: string;
    id: number;
    /** Spine id — what the bill-wise link popup settles against. Null on the
     *  synthetic opening row, which is a master-page figure, not a voucher. */
    universalVoucherId: number | null;
    /** Which register this row belongs to, so the 3-dot menu and the reference
     *  link open the right form (bills are "inv", receipts / notes are "gl"). */
    source: VoucherSource;
    reference: string;
    type: string;
    date: string;
    totalAmount: string;
    amountPaid: string;
    /** What this row does to the running balance, signed onto the party's
     *  normal side — read off their own ledger legs by the server. Not derived
     *  from total − paid: a cash bill is fully paid and moves nothing, while a
     *  receipt has no bill total at all. */
    movement: string;
    /** Settlement state, or null where there is nothing to settle against. */
    settlement: SettlementState | null;
    /** What is still unmatched on this voucher — "0.00" once settled. */
    settlementOpen: string;
    branch:    { name: string };
    createdBy: { name: string };
};

// `TxInvoice` and the parallel Invoice array were retired with the
// Invoice → InvVoucher consolidation (Layer 3b, 2026-05-24). Callers
// now pass a single `invVouchers` list.
/** `accountId` is the party's ledger — the bill-wise popup measures a link on
 *  it. Null when the party has no ledger account, and then nothing is linkable. */
export type CustomerTransactions = { invVouchers: TxInvVoucher[]; accountId: number | null };

// Settled — nothing of this voucher is left sitting on the party's account.
// Due — none of it has been matched to the other side yet.
// Partial — some has.
const SETTLEMENT_STYLES: Record<SettlementState, { label: string; className: string }> = {
    SETTLED: { label: "Settled", className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    PARTIAL: { label: "Partial", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    DUE:     { label: "Due",     className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

export function TransactionsTable({ invVouchers, accountId, partyName, onChanged }: {
    invVouchers: TxInvVoucher[];
    /** The party's ledger account — what the bill-wise popup settles against.
     *  Null only where the party has no ledger, and then nothing is linkable. */
    accountId?:  number | null;
    partyName?:  string;
    onChanged?:  () => void;
}) {
    // Which voucher's bill-wise popup is open, if any.
    const [linkVoucherId, setLinkVoucherId] = useState<number | null>(null);

    type Row = {
        rowKey:     string;
        id:         number;
        uvId:       number | null;
        source:     VoucherSource;
        ref:        string;
        type:       string;
        kind:       string;
        date:       string;
        total:      number;
        paid:       number;
        movement:   number;
        settlement: SettlementState | null;
        open:       number;
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
        uvId:       v.universalVoucherId,
        source:     v.source,
        ref:        v.reference,
        type:       formatType(v.type),
        kind:       v.type,
        date:       v.date,
        total:      Number(v.totalAmount),
        paid:       Number(v.amountPaid),
        movement:   Number(v.movement),
        settlement: v.settlement,
        open:       Number(v.settlementOpen),
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
                                    {(() => {
                                        if (!row.settlement) return <span className="opacity-40 text-xs">—</span>;
                                        const style = SETTLEMENT_STYLES[row.settlement];
                                        const label = row.open > 0.005
                                            ? `${style.label} ${money(row.open)}`
                                            : style.label;
                                        // Only a voucher that actually put something on the
                                        // party's account can be matched off. A bill taken in
                                        // full at the counter has nothing to point at a receipt.
                                        const linkable = row.uvId !== null
                                            && accountId != null
                                            && Math.abs(row.movement) > 0.005;
                                        const chip = `inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${style.className}`;
                                        return linkable ? (
                                            <button
                                                type="button"
                                                title="Match this against the other side, bill by bill"
                                                onClick={() => setLinkVoucherId(row.uvId)}
                                                className={`${chip} cursor-pointer transition-opacity hover:opacity-80`}
                                            >
                                                {label}
                                                <Link2 size={11} className="opacity-70" />
                                            </button>
                                        ) : (
                                            <span className={chip}>{label}</span>
                                        );
                                    })()}
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

            {/* The same bill-wise popup the receipt and trading voucher forms
                open after posting — tick list, Auto, part amounts and all. */}
            {linkVoucherId !== null && accountId != null && (
                <BillLinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setLinkVoucherId(null); }}
                    accountId={accountId}
                    partyName={partyName}
                    voucherId={linkVoucherId}
                    onSaved={() => { clearBillLinkCache(); setLinkVoucherId(null); onChanged?.(); }}
                />
            )}
        </Card>
    );
}
