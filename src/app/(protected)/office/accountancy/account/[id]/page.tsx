"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useEscapeBack } from "@/modules/accountancy/hooks/useEscapeBack";

interface SourceDoc {
    kind: "sale" | "purchase" | "estimate" | "invoice";
    id: number;
    reference?: string;
    number?: string;
    url: string;
}
interface LedgerRow {
    id: number;
    journalEntryId: number;
    date: string;
    reference: string;
    description: string;
    lineDescription: string | null;
    branchId: string | null;
    branchName: string | null;
    debit: number | null;
    credit: number | null;
    balance: number;
    source: SourceDoc | null;
}
interface LedgerData {
    account: {
        id: number; code: string | null; name: string;
        normalBalance: "DEBIT" | "CREDIT";
        groupId: number | null; groupName: string | null;
    };
    from: string;
    to: string;
    openingBalance: number;
    closingBalance: number;
    rows: LedgerRow[];
}

const SRC_COLOR: Record<SourceDoc["kind"], string> = {
    sale: "bg-green-50 text-green-700 border-green-200",
    purchase: "bg-blue-50 text-blue-700 border-blue-200",
    estimate: "bg-amber-50 text-amber-700 border-amber-200",
    invoice: "bg-purple-50 text-purple-700 border-purple-200",
};

export default function AccountLedgerPage() {
    const router = useRouter();
    const { id } = useParams<{ id: string }>();
    const search = useSearchParams();

    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(search.get("from") ?? toIsoDate(fyStart));
    const [to, setTo] = useState(search.get("to") ?? toIsoDate(new Date()));
    const [data, setData] = useState<LedgerData | null>(null);
    const [loading, setLoading] = useState(true);

    // Escape goes back to the previous page (the report you came from).
    useEscapeBack();

    const load = useCallback(() => {
        setLoading(true);
        axios.get<LedgerData>(`/api/accountancy/reports/ledger/${id}?from=${from}&to=${to}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load ledger"))
            .finally(() => setLoading(false));
    }, [id, from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 print:hidden">
                <Button variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-foreground">
                        {data?.account.name ?? "Ledger"}
                    </h1>
                    {data?.account.groupName && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                            <Link href={`/office/accountancy/masters/groups/${data.account.groupId}`} className="hover:underline">
                                {data.account.groupName}
                            </Link>
                            {" › "}{data.account.name}
                        </p>
                    )}
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} className="w-auto" />
                    </div>
                    <Button onClick={load}>Refresh</Button>
                    <Button variant="outline" onClick={() => window.print()}><Printer size={14} /></Button>
                </div>
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
                        <span className="font-semibold">{data.account.name}</span>
                        <div className="flex gap-8 text-sm">
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground">Opening</p>
                                <p className="font-mono font-semibold">{fmt(data.openingBalance)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground">Closing</p>
                                <p className="font-mono font-semibold text-primary">{fmt(data.closingBalance)}</p>
                            </div>
                        </div>
                    </div>
                    {data.rows.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground text-sm">No transactions in this period</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium">Date</th>
                                    <th className="px-4 py-2 text-left font-medium">Voucher</th>
                                    <th className="px-4 py-2 text-left font-medium">Description</th>
                                    <th className="px-4 py-2 text-left font-medium">Branch</th>
                                    <th className="px-4 py-2 text-right font-medium">Debit</th>
                                    <th className="px-4 py-2 text-right font-medium">Credit</th>
                                    <th className="px-4 py-2 text-right font-medium">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr
                                        key={row.id}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => router.push(`/office/accountancy/journal-entries/${row.journalEntryId}`)}
                                    >
                                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                                            {new Date(row.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {row.source ? (
                                                <Link
                                                    href={row.source.url}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`text-xs px-2 py-0.5 border rounded-sm font-mono font-medium hover:underline ${SRC_COLOR[row.source.kind]}`}
                                                >
                                                    {row.source.reference ?? row.source.number}
                                                </Link>
                                            ) : <span className="font-mono text-xs text-muted-foreground">{row.reference}</span>}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <p>{row.description}</p>
                                            {row.lineDescription && <p className="text-xs text-muted-foreground">{row.lineDescription}</p>}
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                            {row.branchName ?? <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono">
                                            {row.debit != null ? fmt(row.debit) : <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono">
                                            {row.credit != null ? fmt(row.credit) : <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${row.balance < 0 ? "text-destructive" : ""}`}>
                                            {fmt(row.balance)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
