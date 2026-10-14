"use client";

import { useState } from "react";
import Link from "next/link";
import type { SettlementState } from "@/modules/accountancy/lib/billLink";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { referenceHref, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { BillLinkDialog, clearBillLinkCache } from "@/modules/accountancy/components/BillLinkDialog";
import { BillUnlinkDialog } from "@/modules/accountancy/components/BillUnlinkDialog";
import { SettlementChip } from "@/modules/accountancy/components/SettlementChip";
import { clearPartyCache } from "@/modules/accountancy/components/PartyOutstandingsPanel";
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
 *  bill. Not the voucher's lifecycle — only POSTED vouchers are listed at all.
 *  Defined in `billLink.ts` alongside the rule that computes it; re-exported
 *  here so this tab's own callers are unchanged. */
export type { SettlementState } from "@/modules/accountancy/lib/billLink";

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
    /** Is there anything on this party's OTHER side to match the row against?
     *  False means the popup would open empty — the chip shows no chain. */
    canLink: boolean;
    branch:    { name: string };
    createdBy: { name: string };
    sourceCreatedAt?: string | null;
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
// A colour per voucher family, shown as a small dot beside the type. Families,
// not individual types: bills out, money in, money out, goods in, anything that
// reverses an earlier voucher. The dot lets the eye group a long ledger by kind
// without reading nine rows of text, and adds no colour to the figures — those
// keep their own meaning (see the balance column below).
//
// Deliberately the only place this table names a voucher type: everything else
// reads `formatType`, and an unmapped type simply falls back to a neutral dot.
const TYPE_DOT: Record<string, string> = {
    SALE: "bg-sky-500", POS: "bg-sky-500", ONLINE_INVOICE: "bg-sky-500",
    RECEIPT: "bg-emerald-500",
    PAYMENT: "bg-orange-500",
    PURCHASE: "bg-violet-500", GRN: "bg-violet-500",
    SALE_RETURN: "bg-amber-500", PURCHASE_RETURN: "bg-amber-500",
    CREDIT_NOTE: "bg-amber-500", DEBIT_NOTE: "bg-amber-500",
    OPENING: "bg-muted-foreground/40",
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
    // Which voucher's Remove link popup is open, if any.
    const [unlinkRow, setUnlinkRow] = useState<{ uvId: number; ref: string } | null>(null);

    type Row = {
        rowKey:          string;
        id:              number;
        uvId:            number | null;
        source:          VoucherSource;
        ref:             string;
        type:            string;
        kind:            string;
        date:            string;
        sourceCreatedAt: string | null;
        total:           number;
        paid:            number;
        movement:        number;
        settlement:      SettlementState | null;
        open:            number;
        canLink:         boolean;
        url:             string | null;
        branchName:      string | null;
        createdBy:       string | null;
        balance:         number; // running balance — set in second pass below
        isOpening:       boolean;
    };

    // "OPENING" is this table's own synthetic row, not a real voucher type, so the
    // shared map has no entry for it and would pass the raw word through.
    const formatType = (type: string) =>
        type === "OPENING" ? "Opening" : voucherTypeLabel(type) ?? type;

    // Build raw rows (balance will be filled below)
    const rawRows: Omit<Row, "balance">[] = invVouchers.map((v) => ({
        rowKey:          v.rowKey,
        id:              v.id,
        uvId:            v.universalVoucherId,
        source:          v.source,
        ref:             v.reference,
        type:            formatType(v.type),
        kind:            v.type,
        date:            v.date,
        sourceCreatedAt: v.sourceCreatedAt ?? null,
        total:           Number(v.totalAmount),
        paid:            Number(v.amountPaid),
        movement:        Number(v.movement),
        settlement:      v.settlement,
        open:            Number(v.settlementOpen),
        canLink:         v.canLink,
        url:             v.type === "OPENING" ? null : referenceHref(v.source, v.id, v.type),
        branchName:      v.branch.name || null,
        createdBy:       v.createdBy.name || null,
        isOpening:       v.type === "OPENING",
    }));

    // Display newest first. When calendar dates tie (@db.Date), tie-break using
    // wall-clock sourceCreatedAt, then spine universalVoucherId.
    const sortedRaw = [...rawRows].sort((a, b) => {
        const d = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (d !== 0) return d;
        const timeA = a.sourceCreatedAt ? new Date(a.sourceCreatedAt).getTime() : 0;
        const timeB = b.sourceCreatedAt ? new Date(b.sourceCreatedAt).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        return (b.uvId ?? b.id) - (a.uvId ?? a.id);
    });

    // Running balance strictly follows the table's visual sort order:
    // Accumulate from bottom (oldest row, index N-1) to top (newest row, index 0).
    const rows: Row[] = sortedRaw.map((r) => ({ ...r, balance: 0 }));
    let runningBalance = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        runningBalance += rows[i].movement;
        rows[i].balance = runningBalance;
    }

    const money = (n: number) => formatRupeesFromPaise(Math.round(n * 100));

    return (
        <Card className="py-0 overflow-hidden">
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        {/* Tinted, and its hover suppressed — a header is not a row you
                            can land on, so it should not light up like one. */}
                        <TableRow className="bg-muted/60 hover:bg-muted/60">
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
                            <TableRow
                                key={row.rowKey}
                                // Faint striping so the eye can carry one voucher across ten
                                // columns. Kept as an `odd:` variant rather than a plain bg so
                                // the base row's `hover:` still wins — Tailwind orders hover
                                // after odd — and the opening row overrides both sides of the
                                // stripe rather than fighting it.
                                className={cn(
                                    "odd:bg-muted/25",
                                    row.isOpening && "odd:bg-muted/50 even:bg-muted/50",
                                )}
                            >
                                <TableCell className="text-xs text-muted-foreground">
                                    <span className="flex items-center gap-2">
                                        <span className={cn("size-1.5 shrink-0 rounded-full", TYPE_DOT[row.kind] ?? "bg-muted-foreground/40")} />
                                        {row.type}
                                    </span>
                                </TableCell>
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
                                {/* The running balance is the one figure worth colouring: a
                                    minus is money sitting the wrong way round, a zero is
                                    nothing to chase, everything else reads plain. */}
                                <TableCell
                                    className={cn(
                                        "text-right font-mono text-xs font-medium tabular-nums",
                                        row.balance < -0.005
                                            ? "text-rose-600 dark:text-rose-400"
                                            : row.balance < 0.005
                                                ? "text-muted-foreground"
                                                : "text-foreground",
                                    )}
                                >
                                    {money(row.balance)}
                                </TableCell>
                                <TableCell>
                                    {/* Only a voucher that actually put something on the
                                        party's account can be matched off. A bill taken in
                                        full at the counter has nothing to point at a receipt. */}
                                    <SettlementChip
                                        state={row.settlement}
                                        open={row.open}
                                        onLink={row.canLink && row.uvId !== null && accountId != null && Math.abs(row.movement) > 0.005
                                            ? () => setLinkVoucherId(row.uvId)
                                            : undefined}
                                        onUnlink={row.uvId !== null ? () => setUnlinkRow({ uvId: row.uvId!, ref: row.ref }) : undefined}
                                    />
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
                    // The Outstanding tab next door holds this party's open bills
                    // in a module cache and is unmounted right now, so it would
                    // come back showing a bill this link has just settled.
                    onSaved={() => {
                        clearBillLinkCache();
                        clearPartyCache(accountId);
                        setLinkVoucherId(null);
                        onChanged?.();
                    }}
                />
            )}
            {unlinkRow && (
                <BillUnlinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setUnlinkRow(null); }}
                    voucherId={unlinkRow.uvId}
                    reference={unlinkRow.ref}
                    onSaved={() => {
                        clearBillLinkCache();
                        if (accountId != null) clearPartyCache(accountId);
                        onChanged?.();
                    }}
                />
            )}
        </Card>
    );
}
