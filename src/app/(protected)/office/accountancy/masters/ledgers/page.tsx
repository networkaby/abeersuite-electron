"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Loader2, ArrowRight, Pencil, Trash2, Search, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { fmt } from "@/shared/lib/format/moneyInr";
import { CreateLedgerDialog } from "@/modules/accountancy/components/CreateLedgerDialog";
import { EditLedgerDialog, type EditableLedger } from "@/modules/accountancy/components/EditLedgerDialog";
import { flattenGroups } from "@/modules/accountancy/lib/groupOptions";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface LedgerRow {
    id: number;
    name: string;
    /** Alternate names — passed straight to the edit dialog so it opens filled. */
    aliases: string[];
    normalBalance: "DEBIT" | "CREDIT" | null;
    isActive: boolean;
    personId: number | null;
    companyId: number | null;
    /** A staff member's salary ledger — HR owns it, so Delete is locked. */
    isStaffLedger: boolean;
    groupId: number | null;
    balance: number;
    /** Group-specific particulars — see PARTICULARS_SPECS. Carried straight
     *  through to the edit dialog. */
    bankJson: unknown;
    loanJson: unknown;
    creditCardJson: unknown;
    bnplJson: unknown;
    walletJson: unknown;
    gatewayJson: unknown;
    openingBalance: number | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
}

interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    parentId: number | null;
    sortOrder: number;
    isActive: boolean;
    totalBalance: number;
    _count: { children: number; accounts: number };
    children: GroupNode[];
    ledgers: LedgerRow[];
    /** True direct-ledger count; `ledgers` is capped server-side for display. */
    ledgerTotal: number;
}

// A flattened, depth-tagged row — a group header, one of its ledgers, or a
// "+N more" footer when the group's ledger list was capped.
type VisibleRow =
    | { kind: "group"; depth: number; hasChildren: boolean; group: GroupNode }
    | { kind: "ledger"; depth: number; ledger: LedgerRow }
    | { kind: "more"; depth: number; group: GroupNode };

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET: "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME: "bg-green-50 text-green-700 border-green-200",
    EXPENSE: "bg-red-50 text-red-700 border-red-200",
};

// Walk the tree, emitting a group row then — when expanded — its child groups
// (recursively) followed by its own ledger accounts one level deeper.
function flattenVisible(nodes: GroupNode[], expanded: Set<number>, depth = 0): VisibleRow[] {
    const result: VisibleRow[] = [];
    for (const n of nodes) {
        const hasChildren = n.children.length > 0 || n.ledgers.length > 0;
        result.push({ kind: "group", depth, hasChildren, group: n });
        if (expanded.has(n.id) && hasChildren) {
            result.push(...flattenVisible(n.children, expanded, depth + 1));
            for (const l of n.ledgers) {
                result.push({ kind: "ledger", depth: depth + 1, ledger: l });
            }
            if (n.ledgerTotal > n.ledgers.length) {
                result.push({ kind: "more", depth: depth + 1, group: n });
            }
        }
    }
    return result;
}

function allGroupsFlat(nodes: GroupNode[]): GroupNode[] {
    const result: GroupNode[] = [];
    for (const n of nodes) {
        result.push(n);
        result.push(...allGroupsFlat(n.children));
    }
    return result;
}

function countLedgers(nodes: GroupNode[]): number {
    let n = 0;
    for (const g of nodes) n += g.ledgerTotal + countLedgers(g.children);
    return n;
}

function drCr(balance: number): string {
    if (balance === 0) return "0.00";
    const abs = fmt(Math.abs(balance));
    return balance > 0 ? `${abs} Dr` : `${abs} Cr`;
}

export default function LedgersPage() {
    const router = useRouter();

    const [tree, setTree] = useState<GroupNode[]>([]);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    // The server does the matching (the tree only carries 50 ledgers a group),
    // so wait for a pause in typing before asking.
    const query = useDebouncedValue(search.trim(), 300);
    const loadSeq = useRef(0);

    // Create and edit both run in dialogs. An inline form would push the rows
    // below it down the page, moving whatever the user was looking at.
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<EditableLedger | null>(null);

    // Refetch without flipping `loading` — the full-page spinner is for the
    // first load only. Re-showing it after every save unmounted the whole
    // table (page blink + lost scroll position).
    const load = useCallback(() => {
        const seq = ++loadSeq.current;
        const qs = query ? `&q=${encodeURIComponent(query)}` : "";
        axios.get<GroupNode[]>(`/api/accountancy/account-groups?withLedgers=1${qs}`)
            .then((r) => {
                if (seq !== loadSeq.current) return; // a newer search is in flight
                setTree(r.data);
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    return new Set(r.data.map((g) => g.id));
                });
            })
            .catch(() => toast.error("Failed to load account groups"))
            .finally(() => setLoading(false));
    }, [query]);

    useEffect(() => { load(); }, [load]);
    // Balances move with every voucher; `load` keeps the spinner off after first paint.
    useRealtimeTopics(["ledger"], load);

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });

    const allFlat = allGroupsFlat(tree);
    // Depth-tagged copy for the dialogs' group picker (indents sub-groups).
    const groupOptions = flattenGroups(tree);
    // While searching, every group opens so the matches are visible.
    const flat = flattenVisible(tree, query ? new Set(allFlat.map((g) => g.id)) : expanded);
    const ledgerCount = countLedgers(tree);

    const deleteLedger = async (l: LedgerRow) => {
        if (!(await confirmAction({ title: `Delete ledger "${l.name}"?`, confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/accountancy/ledgers/${l.id}`);
            toast.success("Ledger deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete ledger");
        }
    };

    return (
        // Header sits outside the scroller so "New Ledger" stays reachable no
        // matter how far down the tree the user has scrolled.
        <div className="flex h-full flex-col">
            <div className="shrink-0 bg-background px-6 py-3">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Ledgers</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {query
                                ? `${ledgerCount} ledgers match "${query}"`
                                : `${allFlat.length} groups · ${ledgerCount} ledgers — expand a group to see its ledgers`}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search ledgers or groups"
                                aria-label="Search ledgers"
                                className="h-9 w-64 pl-8 pr-8"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch("")}
                                    aria-label="Clear search"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <Button onClick={() => setAddOpen(true)}>
                            <Plus size={16} /> New Ledger
                        </Button>
                    </div>
                </div>
            </div>

            {/* min-h-0 lets this flex child shrink so the card — and the
                scroller inside it — get a real bounded height instead of
                growing to fit every row. */}
            <div className="min-h-0 flex-1 px-6 pt-4 pb-6">
                <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow">
                    {loading ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Loader2 className="animate-spin text-muted-foreground" size={32} />
                        </div>
                    ) : (
                        // A native scroller, not <ScrollArea>: Radix wraps its
                        // viewport's children in a `display: table` element,
                        // which makes `position: sticky` headers unreliable.
                        <div className="flex-1 overflow-y-auto">
                            <table className="w-full text-sm">
                                {/* Sticky column headers — the rows scroll under
                                    them, so they stay readable all the way down.
                                    Sticky goes on the cells, not <thead>, for
                                    Safari; each needs its own background or the
                                    rows show through. */}
                                <thead>
                                    <tr className="text-xs text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-muted">
                                        <th className="px-4 py-2.5 text-left font-medium w-8" />
                                        <th className="px-4 py-2.5 text-left font-medium">Name of Group</th>
                                        <th className="px-4 py-2.5 text-left font-medium w-28">Type</th>
                                        <th className="px-4 py-2.5 text-right font-medium w-24">Accounts</th>
                                        <th className="px-4 py-2.5 text-right font-medium w-36">Balance</th>
                                        <th className="px-4 py-2.5 w-16" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {flat.map((row) => {
                                        // ── Group header row ──────────────────────────────
                                        if (row.kind === "group") {
                                            const g = row.group;
                                            return (
                                                <tr
                                                    key={`g-${g.id}`}
                                                    className="border-b last:border-0 hover:bg-muted/40"
                                                >
                                                    {/* Expand chevron */}
                                                    <td className="px-2 py-2.5 text-center w-8">
                                                        {row.hasChildren ? (
                                                            <button
                                                                onClick={() => toggle(g.id)}
                                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                                            >
                                                                {expanded.has(g.id)
                                                                    ? <ChevronDown size={14} />
                                                                    : <ChevronRight size={14} />}
                                                            </button>
                                                        ) : null}
                                                    </td>

                                                    {/* Name (indented by depth) */}
                                                    <td className="py-2.5 pr-4">
                                                        <div style={{ paddingLeft: row.depth * 20 }}>
                                                            {g._count.accounts > 0 ? (
                                                                <Link
                                                                    href={`/office/accountancy/masters/ledgers/${g.id}`}
                                                                    className={`font-medium hover:underline hover:text-primary ${row.depth === 0 ? "text-foreground" : "text-muted-foreground"}`}
                                                                >
                                                                    {g.name}
                                                                </Link>
                                                            ) : (
                                                                <span className={`font-medium ${row.depth === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                                                    {g.name}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {/* Type badge */}
                                                    <td className="px-4 py-2.5">
                                                        <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[g.type]}`}>
                                                            {g.type}
                                                        </span>
                                                    </td>

                                                    {/* Account count */}
                                                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                                        {g._count.accounts > 0
                                                            ? <span className="font-medium text-foreground">{g._count.accounts}</span>
                                                            : <span className="text-muted-foreground/65">—</span>}
                                                    </td>

                                                    {/* Balance (rolled up) */}
                                                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                        {g._count.accounts > 0
                                                            ? <span className={g.totalBalance < 0 ? "text-destructive" : "text-foreground"}>
                                                                {drCr(g.totalBalance)}
                                                            </span>
                                                            : <span className="text-muted-foreground/65">—</span>}
                                                    </td>

                                                    {/* View accounts link */}
                                                    <td className="px-4 py-2.5 text-right">
                                                        {g._count.accounts > 0 && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1"
                                                                onClick={() => router.push(`/office/accountancy/masters/ledgers/${g.id}`)}
                                                            >
                                                                View <ArrowRight size={12} />
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        // ── "View all" footer when the ledger list is capped ──
                                        if (row.kind === "more") {
                                            const g = row.group;
                                            return (
                                                <tr key={`m-${g.id}`} className="border-b last:border-0 bg-muted/10">
                                                    <td className="px-2 py-2 w-8" />
                                                    <td className="py-2 pr-4" colSpan={5}>
                                                        <div style={{ paddingLeft: row.depth * 20 }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => router.push(`/office/accountancy/masters/ledgers/${g.id}`)}
                                                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                                                            >
                                                                Showing {g.ledgers.length} of {g.ledgerTotal} ledgers — View all
                                                                <ArrowRight size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        // ── Ledger (leaf) row ─────────────────────────────
                                        const l = row.ledger;
                                        // Owned by a contact or a staff profile: tagged, and Delete is
                                        // locked — the server refuses it anyway.
                                        const ownerTag = l.personId ? "Customer" : l.companyId ? "Company" : l.isStaffLedger ? "Staff" : null;
                                        return (
                                            <tr
                                                key={`l-${l.id}`}
                                                className={`border-b last:border-0 hover:bg-muted/30 ${!l.isActive ? "opacity-60" : ""}`}
                                            >
                                                {/* No chevron for leaves */}
                                                <td className="px-2 py-2 w-8" />

                                                {/* Ledger name (one level deeper than its group) */}
                                                <td className="py-2 pr-4">
                                                    <div style={{ paddingLeft: row.depth * 20 }}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-foreground">{l.name}</span>
                                                            {ownerTag && (
                                                                <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                                    {ownerTag}
                                                                </span>
                                                            )}
                                                            {!l.isActive && (
                                                                <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                                    Inactive
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Type column — blank for ledgers */}
                                                <td className="px-4 py-2" />

                                                {/* Account count — blank for ledgers */}
                                                <td className="px-4 py-2" />

                                                {/* Balance */}
                                                <td className="px-4 py-2 text-right font-mono text-xs">
                                                    {l.balance !== 0
                                                        ? <span className={l.balance < 0 ? "text-destructive" : "text-foreground"}>
                                                            {drCr(l.balance)}
                                                        </span>
                                                        : <span className="text-muted-foreground">0.00</span>}
                                                </td>

                                                {/* Edit / delete buttons */}
                                                <td className="px-4 py-2 text-right">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <Button
                                                            variant="ghost" size="icon-sm"
                                                            className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                            onClick={() => setEditTarget(l)}
                                                            aria-label={`Edit ${l.name}`}
                                                        >
                                                            <Pencil size={14} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="icon-sm"
                                                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                            onClick={() => deleteLedger(l)}
                                                            disabled={ownerTag !== null}
                                                            aria-label={`Delete ${l.name}`}
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {flat.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                                {query ? `Nothing matches "${query}".` : "No groups found."}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <CreateLedgerDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                groups={groupOptions}
                onCreated={load}
            />

            <EditLedgerDialog
                open={editTarget !== null}
                onOpenChange={(v) => { if (!v) setEditTarget(null); }}
                ledger={editTarget}
                groups={groupOptions}
                onSaved={load}
            />
        </div>
    );
}
