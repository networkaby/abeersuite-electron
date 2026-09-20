"use client";

// Money tab — what the books say about this person. Their own ledger under
// "Salary Payable": a credit balance is salary owed to them, a debit balance is
// an advance they still hold. Payments and advances are ordinary Payment
// vouchers against that ledger; this tab only reads and points.

import Link from "next/link";
import { BookOpen, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatInr } from "@/shared/lib/format/moneyInr";
import type { StaffDetail } from "../lib/staffTypes";

/** One line of GET /api/accountancy/reports/ledger/[accountId] — the fields this tab reads. */
interface LedgerRow {
    id: number;
    date: string;
    reference: string;
    voucherType: string;
    description: string;
    lineDescription: string | null;
    debit: number | null;
    credit: number | null;
    balance: number;
}

interface LedgerReport {
    account: { id: number; name: string; normalBalance: "DEBIT" | "CREDIT" };
    from: string;
    to: string;
    openingBalance: number;
    closingBalance: number;
    rows: LedgerRow[];
}

export default function StaffMoneyTab({ detail }: { detail: StaffDetail }) {
    const ledger = detail.ledger;
    const { data, loading, error, reload } = useApiResource<LedgerReport>(ledger ? `/api/accountancy/reports/ledger/${ledger.id}` : null);
    useRealtimeTopics(["ledger"], reload, !!ledger);

    if (!ledger) {
        return (
            <p className="text-sm text-muted-foreground">
                No ledger yet. Save anything on the Job tab and {detail.user.name.split(" ")[0]}&apos;s own ledger is opened under &ldquo;Salary Payable&rdquo;.
            </p>
        );
    }

    // The ledger's normal balance is CREDIT: positive = owed to them.
    const closing = data?.closingBalance ?? ledger.balance;
    const owed = closing >= 0;
    const rows = (data?.rows ?? []).slice(-10).reverse();

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{ledger.name}</p>
                    <p className="text-2xl font-semibold tabular-nums">{formatInr(Math.abs(closing))}</p>
                    <p className="text-xs text-muted-foreground">
                        {closing === 0 ? "Nothing outstanding either way." : owed ? "Owed to them (credit balance)." : "Advance they still hold (debit balance)."}
                        {data && ` As of ${formatDate(data.to)}.`}
                    </p>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Button asChild size="sm">
                        <Link href={`/vouchers/payments/new?partyAccountId=${ledger.id}`}>
                            <HandCoins size={14} /> Pay salary / advance
                        </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                        <Link href={`/office/accountancy/masters/ledgers/${ledger.id}`}>
                            <BookOpen size={14} /> Open the ledger
                        </Link>
                    </Button>
                </div>
            </div>

            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Voucher</TableHead>
                                <TableHead>Particulars</TableHead>
                                <TableHead className="text-right">Paid to them</TableHead>
                                <TableHead className="text-right">Accrued</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableEmptyRow colSpan={5} message={`No entries this year (from ${formatDate(data.from)}).`} />
                            ) : rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                                    <TableCell className="text-muted-foreground">{r.reference}</TableCell>
                                    <TableCell className="text-sm">{r.lineDescription || r.description}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.debit ? formatInr(r.debit) : ""}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.credit ? formatInr(r.credit) : ""}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <p className="px-3 py-2 text-xs text-muted-foreground">Last ten entries. The full ledger has every line, with running balance.</p>
                </div>
            )}
        </div>
    );
}
