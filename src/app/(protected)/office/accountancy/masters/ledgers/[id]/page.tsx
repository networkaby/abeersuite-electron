"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    ArrowLeft, Search, ChevronLeft, ChevronRight as ChevronRightIcon,
    Loader2, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";
import { formatDrCr } from "@/shared/lib/format/moneyInr";
import { EditLedgerDialog, type EditableLedger } from "@/modules/accountancy/components/EditLedgerDialog";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

type GroupType  = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type NormalBalance = "DEBIT" | "CREDIT";

interface GroupOption {
    id: number;
    name: string;
    type: GroupType;
}

interface GroupNode extends GroupOption {
    children: GroupNode[];
}

interface LedgerItem {
    id: number;
    name: string;
    aliases: string[];
    type: string | null;
    normalBalance: NormalBalance | null;
    balance: number;
    isActive: boolean;
    customerId: number | null;
    companyId: number | null;
    groupId: number | null;
    group: { id: number; name: string; type: string } | null;
    _count: { lines: number };
    bankJson?: unknown;
    loanJson?: unknown;
    creditCardJson?: unknown;
    bnplJson?: unknown;
    walletJson?: unknown;
    gatewayJson?: unknown;
    openingBalance?: number | null;
    openingBalanceType?: NormalBalance | null;
}

function flatGroups(nodes: GroupNode[]): GroupOption[] {
    const result: GroupOption[] = [];
    for (const n of nodes) {
        result.push({ id: n.id, name: n.name, type: n.type });
        result.push(...flatGroups(n.children));
    }
    return result;
}

const drCr = formatDrCr;

const LIMIT = 20;

export default function GroupLedgersPage() {
    const { id } = useParams<{ id: string }>();
    const router  = useRouter();

    const [groupName, setGroupName]   = useState<string>("");
    const [groupType, setGroupType]   = useState<GroupType | null>(null);
    const [items, setItems]           = useState<LedgerItem[]>([]);
    const [total, setTotal]           = useState(0);
    const [page, setPage]             = useState(1);
    const [search, setSearch]         = useState("");
    const [loading, setLoading]       = useState(true);
    const [editTarget, setEditTarget] = useState<LedgerItem | null>(null);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEscapeBack();

    // Resolve this group's name/type for the header. (Single light call; the
    // balance-heavy `withLedgers` variant is only used by the Ledgers tree
    // page. EditLedgerDialog fetches its own group list for the picker.)
    useEffect(() => {
        axios.get<GroupNode[]>("/api/accountancy/account-groups")
            .then((r) => {
                const g = flatGroups(r.data).find((x) => x.id === Number(id));
                if (g) { setGroupName(g.name); setGroupType(g.type); }
            })
            .catch(() => { /* silent */ });
    }, [id]);

    const load = useCallback((p: number, q: string) => {
        setLoading(true);
        const params = new URLSearchParams({
            groupId:    id,
            page:       String(p),
            limit:      String(LIMIT),
            activeOnly: "false",
            ...(q ? { search: q } : {}),
        });
        axios.get<{ items: LedgerItem[]; total: number }>(`/api/accountancy/ledgers?${params}`)
            .then((r) => {
                setItems(r.data.items);
                setTotal(r.data.total);
            })
            .catch(() => toast.error("Failed to load accounts"))
            .finally(() => setLoading(false));
    }, [id]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(1, ""); }, [load]);
    // Balances move with every voucher; re-read the page the user is on.
    useRealtimeTopics(["ledger"], () => load(page, search));

    const handleSearch = (value: string) => {
        setSearch(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            load(1, value);
        }, 400);
    };

    const goPage = (p: number) => {
        setPage(p);
        load(p, search);
    };

    const totalPages = Math.max(1, Math.ceil(total / LIMIT));

    const TYPE_COLORS: Record<GroupType, string> = {
        ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
        LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
        INCOME:    "bg-green-50 text-green-700 border-green-200",
        EXPENSE:   "bg-red-50 text-red-700 border-red-200",
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-6 px-6 pt-3 pb-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => router.push("/office/accountancy/masters/ledgers")}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                </Button>
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold text-foreground">
                            {groupName || "Accounts"}
                        </h1>
                        {groupType && (
                            <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[groupType]}`}>
                                {groupType}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        <button
                            onClick={() => router.push("/office/accountancy/masters/ledgers")}
                            className="hover:underline"
                        >
                            Ledgers
                        </button>
                        {" › "}
                        {groupName}
                        {" — "}
                        {total.toLocaleString()} account{total !== 1 ? "s" : ""}
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search by name or keyword…"
                    className="pl-9"
                />
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <th className="px-4 py-2.5 text-left font-medium w-12">S.No.</th>
                            <th className="px-4 py-2.5 text-left font-medium">Name</th>
                            <th className="px-4 py-2.5 text-right font-medium w-36">Balance</th>
                            <th className="px-4 py-2.5 text-center font-medium w-20">Status</th>
                            <th className="px-4 py-2.5 w-20" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center">
                                    <Loader2 className="animate-spin text-muted-foreground mx-auto" size={24} />
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                    {search ? `No accounts matching "${search}"` : "No accounts in this group."}
                                </td>
                            </tr>
                        ) : items.map((item, i) => {
                            const isIdentity = item.customerId !== null || item.companyId !== null;
                            const rowNum     = (page - 1) * LIMIT + i + 1;

                            return (
                                <tr
                                    key={item.id}
                                    className={`border-b last:border-0 hover:bg-muted/40 ${!item.isActive ? "opacity-50" : ""}`}
                                >
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{rowNum}.</td>

                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-foreground">{item.name}</span>
                                            {isIdentity && (
                                                <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                    {item.customerId ? "Customer" : "Company"}
                                                </span>
                                            )}
                                        </div>
                                        {item.aliases.length > 0 && (
                                            <div className="mt-0.5 text-[11px] italic text-muted-foreground truncate">
                                                {item.aliases.join(", ")}
                                            </div>
                                        )}
                                    </td>

                                    <td className="px-4 py-2.5 text-right font-mono text-sm">
                                        <span className={item.balance < 0 ? "text-destructive" : "text-foreground"}>
                                            {drCr(item.balance, item.normalBalance)}
                                        </span>
                                    </td>

                                    <td className="px-4 py-2.5 text-center">
                                        <span className={`text-xs px-2 py-0.5 border font-medium ${item.isActive ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>
                                            {item.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </td>

                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            <Button
                                                variant="ghost" size="icon-sm"
                                                className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                onClick={() => setEditTarget(item)}
                                            >
                                                <Pencil size={14} />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                        Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline" size="sm"
                            onClick={() => goPage(page - 1)}
                            disabled={page <= 1}
                        >
                            <ChevronLeft size={14} /> Prev
                        </Button>
                        <span className="text-xs px-2">
                            Page {page} of {totalPages}
                        </span>
                        <Button
                            variant="outline" size="sm"
                            onClick={() => goPage(page + 1)}
                            disabled={page >= totalPages}
                        >
                            Next <ChevronRightIcon size={14} />
                        </Button>
                    </div>
                </div>
            )}
            </div>

            <EditLedgerDialog
                open={editTarget !== null}
                onOpenChange={(v) => { if (!v) setEditTarget(null); }}
                ledger={editTarget as EditableLedger | null}
                onSaved={() => load(page, search)}
            />
        </ScrollArea>
    );
}
