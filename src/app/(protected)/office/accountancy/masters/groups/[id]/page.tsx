"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, FolderTree, BookOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface GroupDetailGroup {
    id: number; name: string; type: GroupTypeStr; parentId: number | null;
    sortOrder: number;
    parent: { id: number; name: string } | null;
}
interface SubGroup {
    id: number; name: string; type: GroupTypeStr;
    accountCount: number;
    childGroupCount: number;
    rolledUpBalance: number;
}
interface Ledger {
    id: number; name: string;
    customerId: number | null; companyId: number | null;
    balance: number;
    normalBalance: "DEBIT" | "CREDIT" | null;
}

interface GroupDetailData {
    group: GroupDetailGroup;
    subGroups: SubGroup[];
    ledgers: Ledger[];
    totalBalance: number;
}

const TYPE_COLORS: Record<GroupTypeStr, string> = {
    ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME:    "bg-green-50 text-green-700 border-green-200",
    EXPENSE:   "bg-red-50 text-red-700 border-red-200",
};

export default function GroupDetailPage() {
    const router = useRouter();
    const search = useSearchParams();
    const { id } = useParams<{ id: string }>();
    const [data, setData] = useState<GroupDetailData | null>(null);
    const [loading, setLoading] = useState(true);

    // Escape goes back to the previous page (the report you came from).
    useEscapeBack();

    /** `silent` keeps the group on screen while it re-reads. */
    const load = useCallback((silent = false) => {
        if (!silent) setLoading(true);
        axios.get<GroupDetailData>(`/api/accountancy/groups/${id}/detail`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load group"))
            .finally(() => setLoading(false));
    }, [id]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);
    // Balances under this group move with every voucher posted anywhere.
    useRealtimeTopics(["ledger"], () => { load(true); });

    // Stock-in-Hand has no real GL children (Closing Stock is synthesised at
    // report time). Bounce any visit to the live stock summary instead of
    // showing the empty group page.
    useEffect(() => {
        if (data?.group.name === "Stock-in-Hand") {
            const asOf = search.get("asOf");
            const qs = asOf ? `?ref=balance-sheet&asOf=${asOf}` : "?ref=balance-sheet";
            router.replace(`/office/inventory/stock-summary${qs}`);
        }
    }, [data, search, router]);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );
    if (!data) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    const periodSuffix = (() => {
        const qs = new URLSearchParams();
        for (const k of ["from", "to", "asOf"]) {
            const v = search.get(k); if (v) qs.set(k, v);
        }
        return qs.toString() ? `?${qs}` : "";
    })();

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-5 px-6 pt-3 pb-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold text-foreground">{data.group.name}</h1>
                        <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[data.group.type]}`}>
                            {data.group.type}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        <Link href="/office/accountancy/masters/ledgers" className="hover:underline">Ledgers</Link>
                        {data.group.parent && (
                            <>
                                {" › "}
                                <Link href={`/office/accountancy/masters/groups/${data.group.parent.id}${periodSuffix}`} className="hover:underline">
                                    {data.group.parent.name}
                                </Link>
                            </>
                        )}
                        {" › "}{data.group.name}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total Balance</p>
                    <p className="font-mono font-bold text-lg">{fmt(data.totalBalance)}</p>
                </div>
            </div>

            {/* Sub-groups */}
            {data.subGroups.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <div className="border-b bg-muted/40 px-4 py-2.5 flex items-center gap-2">
                        <FolderTree size={14} className="text-muted-foreground" />
                        <h2 className="font-semibold text-sm">Sub-groups ({data.subGroups.length})</h2>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground bg-muted">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium">Name</th>
                                <th className="px-4 py-2 text-right font-medium">Sub-groups</th>
                                <th className="px-4 py-2 text-right font-medium">Ledgers</th>
                                <th className="px-4 py-2 text-right font-medium">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.subGroups.map((sg) => (
                                <tr
                                    key={sg.id}
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => router.push(`/office/accountancy/masters/groups/${sg.id}${periodSuffix}`)}
                                >
                                    <td className="px-4 py-2.5">
                                        <span className="font-medium hover:underline">{sg.name}</span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                        {sg.childGroupCount > 0 ? sg.childGroupCount : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                        {sg.accountCount > 0 ? sg.accountCount : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono">
                                        {sg.rolledUpBalance !== 0 ? fmt(sg.rolledUpBalance) : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Ledgers */}
            {data.ledgers.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <div className="border-b bg-muted/40 px-4 py-2.5 flex items-center gap-2">
                        <BookOpen size={14} className="text-muted-foreground" />
                        <h2 className="font-semibold text-sm">Ledger Accounts ({data.ledgers.length})</h2>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground bg-muted">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium">Name</th>
                                <th className="px-4 py-2 text-right font-medium">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.ledgers.map((l) => (
                                <tr
                                    key={l.id}
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => router.push(accountLedgerUrl(l.id, {
                                        from: search.get("from") ?? undefined,
                                        to:   search.get("to")   ?? undefined,
                                        asOf: search.get("asOf") ?? undefined,
                                    }))}
                                >
                                    <td className="px-4 py-2.5">
                                        <span className="font-medium hover:underline">{l.name}</span>
                                        {(l.customerId || l.companyId) && (
                                            <span className="ml-2 text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                {l.customerId ? "Customer" : "Company"}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono">
                                        {l.balance !== 0 ? fmt(l.balance) : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data.subGroups.length === 0 && data.ledgers.length === 0 && (
                <div className="text-center py-16 text-muted-foreground text-sm">
                    No sub-groups or ledger accounts in this group yet.
                </div>
            )}
            </div>
        </ScrollArea>
    );
}
