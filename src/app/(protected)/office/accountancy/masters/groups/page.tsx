"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Pencil, Trash2, Loader2, Check, X, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CreateGroupDialog } from "@/modules/accountancy/components/CreateGroupDialog";
import { invalidateGroupOptions } from "@/modules/accountancy/lib/groupOptions";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    parentId: number | null;
    sortOrder: number;
    isActive: boolean;
    _count: { children: number; accounts: number };
    children: GroupNode[];
}

interface FlatRow extends Omit<GroupNode, "children"> {
    depth: number;
    hasChildren: boolean;
}

function flattenVisible(nodes: GroupNode[], expanded: Set<number>, depth = 0): FlatRow[] {
    const result: FlatRow[] = [];
    for (const n of nodes) {
        result.push({ ...n, depth, hasChildren: n.children.length > 0 });
        if (expanded.has(n.id) && n.children.length > 0) {
            result.push(...flattenVisible(n.children, expanded, depth + 1));
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

// Keep a group when its name matches (with its whole subtree) or when a
// descendant matches (so the path to it stays visible).
function pruneToMatches(nodes: GroupNode[], needle: string): GroupNode[] {
    const result: GroupNode[] = [];
    for (const n of nodes) {
        if (n.name.toLowerCase().includes(needle)) { result.push(n); continue; }
        const kids = pruneToMatches(n.children, needle);
        if (kids.length > 0) result.push({ ...n, children: kids });
    }
    return result;
}

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME:    "bg-green-50 text-green-700 border-green-200",
    EXPENSE:   "bg-red-50 text-red-700 border-red-200",
};

const TYPE_LABELS: Record<GroupType, string> = {
    ASSET: "Asset", LIABILITY: "Liability", INCOME: "Income", EXPENSE: "Expense",
};

const cellClass = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function AccountGroupsPage() {
    const [tree, setTree]         = useState<GroupNode[]>([]);
    const [loading, setLoading]   = useState(true);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [addOpen, setAddOpen]   = useState(false);
    const [saving, setSaving]     = useState(false);
    const [search, setSearch]     = useState("");

    // Edit state — an inline row editor (widens a few cells, no block push),
    // unlike the old "New Group" form which pushed the whole table down.
    const [editId, setEditId]           = useState<number | null>(null);
    const [editName, setEditName]       = useState("");
    const [editParent, setEditParent]   = useState<string>("none");
    const [editSort, setEditSort]       = useState("0");

    // Refetch without flipping `loading` — the full-page spinner is for the
    // first load only. Re-showing it after every save unmounted the whole
    // tree (page blink + lost scroll position).
    const load = useCallback(() => {
        axios.get<GroupNode[]>("/api/accountancy/account-groups")
            .then((r) => {
                setTree(r.data);
                // Auto-expand primary groups on first load
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    return new Set(r.data.map((g) => g.id));
                });
            })
            .catch(() => toast.error("Failed to load account groups"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);
    // A group added or renamed at another counter shows up here on its own.
    // `load` never flips `loading`, so this cannot blink the tree.
    useRealtimeTopics(["ledger"], load);

    const allFlat = allGroupsFlat(tree);
    const needle  = search.trim().toLowerCase();
    // While searching, show only matches (with their parents) and open them all.
    const shown   = needle ? pruneToMatches(tree, needle) : tree;
    const flat    = flattenVisible(shown, needle ? new Set(allGroupsFlat(shown).map((g) => g.id)) : expanded);

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });

    const startEdit = (row: FlatRow) => {
        setEditId(row.id);
        setEditName(row.name);
        setEditParent(row.parentId ? String(row.parentId) : "none");
        setEditSort(String(row.sortOrder));
    };

    const saveEdit = async (id: number) => {
        setSaving(true);
        try {
            await axios.patch(`/api/accountancy/account-groups/${id}`, {
                name:      editName.trim(),
                parentId:  editParent !== "none" ? Number(editParent) : null,
                sortOrder: Number(editSort) || 0,
            });
            invalidateGroupOptions();
            toast.success("Updated");
            setEditId(null);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const deleteGroup = async (id: number, name: string) => {
        if (!(await confirmAction({ title: `Delete group "${name}"?`, confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/accountancy/account-groups/${id}`);
            invalidateGroupOptions();
            toast.success("Deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete");
        }
    };

    return (
        // Header sits outside the scroller so "New Group" stays reachable no
        // matter how far down the tree the user has scrolled.
        <div className="flex h-full flex-col">
            <div className="shrink-0 bg-background px-6 py-3">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Account Groups</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Multi Group Alteration — {needle ? `${allGroupsFlat(shown).length} of ${allFlat.length}` : allFlat.length} groups
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search groups"
                                aria-label="Search groups"
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
                            <Plus size={16} /> New Group
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
                                <thead>
                                    <tr className="text-xs text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-muted">
                                        <th className="px-4 py-2.5 text-left font-medium w-12">S.No.</th>
                                        <th className="px-4 py-2.5 text-left font-medium">Name of Group</th>
                                        <th className="px-4 py-2.5 text-left font-medium w-48">Under</th>
                                        <th className="px-4 py-2.5 text-left font-medium w-28">Type</th>
                                        <th className="px-4 py-2.5 text-right font-medium w-20">Sort</th>
                                        <th className="px-4 py-2.5 w-24" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {flat.map((row, i) => {
                                        const isEditing = editId === row.id;
                                        return (
                                            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                                                <td className="px-4 py-2.5 text-muted-foreground text-xs">{i + 1}.</td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-1" style={{ paddingLeft: row.depth * 20 }}>
                                                        {row.hasChildren ? (
                                                            <button
                                                                onClick={() => toggle(row.id)}
                                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                                            >
                                                                {expanded.has(row.id)
                                                                    ? <ChevronDown size={14} />
                                                                    : <ChevronRight size={14} />}
                                                            </button>
                                                        ) : (
                                                            <span className="w-3.5 inline-block" />
                                                        )}
                                                        {isEditing ? (
                                                            <input
                                                                value={editName}
                                                                onChange={(e) => setEditName(e.target.value)}
                                                                className={cellClass}
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <span className={`font-medium text-foreground ${row.depth === 0 ? "" : "text-muted-foreground"}`}>
                                                                {row.name}
                                                            </span>
                                                        )}
                                                        {row._count.accounts > 0 && !isEditing && (
                                                            <span className="ml-1 text-xs text-muted-foreground">
                                                                ({row._count.accounts})
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                                                    {isEditing ? (
                                                        <Select value={editParent} onValueChange={setEditParent}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Primary" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="none">Primary (no parent)</SelectItem>
                                                                {allFlat.filter((g) => g.id !== row.id).map((g) => (
                                                                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        row.parentId
                                                            ? allFlat.find((g) => g.id === row.parentId)?.name ?? "—"
                                                            : <span className="italic">Primary</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[row.type]}`}>
                                                        {TYPE_LABELS[row.type]}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={editSort}
                                                            onChange={(e) => setEditSort(e.target.value)}
                                                            className={`${cellClass} w-20 text-right`}
                                                        />
                                                    ) : row.sortOrder}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        {isEditing ? (
                                                            <>
                                                                <Button variant="ghost" size="icon-sm" className="text-green-600 hover:bg-green-50"
                                                                    onClick={() => saveEdit(row.id)} disabled={saving}>
                                                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                                </Button>
                                                                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-muted"
                                                                    onClick={() => setEditId(null)}>
                                                                    <X size={14} />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button variant="ghost" size="icon-sm"
                                                                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                                    onClick={() => startEdit(row)}>
                                                                    <Pencil size={14} />
                                                                </Button>
                                                                <Button variant="ghost" size="icon-sm"
                                                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                                    onClick={() => deleteGroup(row.id, row.name)}
                                                                    disabled={row._count.children > 0 || row._count.accounts > 0}>
                                                                    <Trash2 size={14} />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {flat.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                                {needle
                                                    ? `No group matches "${search.trim()}".`
                                                    : <>No groups yet. Click &quot;New Group&quot; to create one.</>}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <CreateGroupDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                groups={allFlat}
                onCreated={load}
            />
        </div>
    );
}
