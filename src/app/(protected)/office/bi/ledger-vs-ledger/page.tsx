"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Printer } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt, formatDrCr } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useGlAccounts } from "@/shared/hooks/useGlAccounts";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { GlAccountCombobox } from "@/modules/accountancy/components/GlAccountCombobox";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { KpiCard } from "@/modules/bi/components/KpiCard";

interface Row {
    voucherId: number; voucherType: string; date: string; reference: string;
    description: string; debit: number; credit: number; balance: number; href: string | null;
}
interface Report {
    branches: BranchOption[];
    rows: Row[];
    totals: { vouchers: number; debit: number; credit: number; net: number };
}

const drCr = (n: number) => formatDrCr(n, "DEBIT");

export default function LedgerVsLedgerPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [a, setA] = useState<number | null>(null);
    const [b, setB] = useState<number | null>(null);
    // The chart of accounts already held in memory for voucher forms — no extra read.
    const { accounts } = useGlAccounts();

    const ready = a != null && b != null && a !== b;
    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/ledger-vs-ledger?a=${a ?? ""}&b=${b ?? ""}&from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );
    const nameOf = (id: number | null) => accounts.find((x) => x.id === id)?.name ?? "";

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Ledger vs Ledger</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Only the vouchers between two ledgers — amounts as posted on Ledger A, balance from zero.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <Button size="sm" variant="outline" className="h-9" onClick={() => window.print()} aria-label="Print">
                            <Printer size={14} />
                        </Button>
                    }
                />
            </div>

            <div className="flex items-end gap-2 flex-wrap">
                <div className="space-y-1 w-72">
                    <Label>Ledger A</Label>
                    <GlAccountCombobox value={a} onChange={(x) => setA(x?.id ?? null)} accounts={accounts}
                        minChars={1} allowCreate={false} allowEdit={false} placeholder="Search ledger…" />
                </div>
                <Button size="sm" variant="outline" className="h-9" title="Swap A and B"
                    onClick={() => { setA(b); setB(a); }}>
                    <ArrowLeftRight size={14} />
                </Button>
                <div className="space-y-1 w-72">
                    <Label>Ledger B</Label>
                    <GlAccountCombobox value={b} onChange={(x) => setB(x?.id ?? null)} accounts={accounts}
                        minChars={1} allowCreate={false} allowEdit={false} placeholder="Search ledger…" />
                </div>
            </div>

            {!ready ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                    {a != null && a === b ? "Pick two different ledgers." : "Pick Ledger A and Ledger B to see the vouchers between them."}
                </div>
            ) : (
                <>
                    {status}
                    {data && (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <KpiCard label="Vouchers" value={String(data.totals.vouchers)} />
                                <KpiCard label={`${nameOf(a)} Debit`} value={fmt(data.totals.debit)} />
                                <KpiCard label={`${nameOf(a)} Credit`} value={fmt(data.totals.credit)} />
                                <KpiCard label="Net (A side)" value={drCr(data.totals.net)} tone="primary" />
                            </div>

                            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                <table className="w-full text-sm">
                                    <thead className="border-b bg-muted text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">Date</th>
                                            <th className="px-3 py-2 text-left font-medium">Voucher</th>
                                            <th className="px-3 py-2 text-left font-medium">Type</th>
                                            <th className="px-3 py-2 text-left font-medium">Narration</th>
                                            <th className="px-3 py-2 text-right font-medium">Debit</th>
                                            <th className="px-3 py-2 text-right font-medium">Credit</th>
                                            <th className="px-3 py-2 text-right font-medium">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.rows.length === 0 ? (
                                            <tr><td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">No vouchers between these two ledgers in this period.</td></tr>
                                        ) : data.rows.map((r) => (
                                            <tr key={r.voucherId} className="border-b last:border-0 hover:bg-muted/40">
                                                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</td>
                                                <td className="px-3 py-2.5 font-mono text-xs">
                                                    {r.href
                                                        ? <Link href={r.href} className="text-primary font-medium hover:underline">{r.reference}</Link>
                                                        : r.reference}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.voucherType.replaceAll("_", " ").toLowerCase()}</td>
                                                <td className="px-3 py-2.5 text-foreground">{r.description}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{r.debit ? fmt(r.debit) : ""}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{r.credit ? fmt(r.credit) : ""}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{drCr(r.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {data.rows.length > 0 && (
                                        <tfoot className="border-t bg-muted/30 font-semibold">
                                            <tr>
                                                <td className="px-3 py-2.5" colSpan={4}>Total</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.debit)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.credit)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{drCr(data.totals.net)}</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
        </ScrollArea>
    );
}
