"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Loader2, ArrowRight,
    Pencil, Check, X, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { GroupCombobox } from "@/modules/accountancy/components/GroupCombobox";

type GroupType  = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface LedgerRow {
    id: number;
    name: string;
    code: string | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
    isActive: boolean;
    personId: number | null;
    companyId: number | null;
    groupId: number | null;
    balance: number;
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
    | { kind: "group";  depth: number; hasChildren: boolean; group: GroupNode }
    | { kind: "ledger"; depth: number; ledger: LedgerRow }
    | { kind: "more";   depth: number; group: GroupNode };

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME:    "bg-green-50 text-green-700 border-green-200",
    EXPENSE:   "bg-red-50 text-red-700 border-red-200",
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

const NONE = "none";

// A ledger's normal balance is inherited from its group's accounting nature.
function inheritedNormalBalance(type: GroupType): "Debit" | "Credit" {
    return type === "ASSET" || type === "EXPENSE" ? "Debit" : "Credit";
}

export default function LedgersPage() {
    const router = useRouter();

    const [tree, setTree]         = useState<GroupNode[]>([]);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading]   = useState(true);
    const [showAdd, setShowAdd]   = useState(false);
    const [saving, setSaving]     = useState(false);

    const [newForm, setNewForm] = useState({
        name: "", groupId: NONE, description: "",
    });

    // Inline ledger edit (name + parent group)
    const [editLedgerId, setEditLedgerId]   = useState<number | null>(null);
    const [editName, setEditName]           = useState("");
    const [editGroupId, setEditGroupId]     = useState<number | null>(null);
    const [savingLedger, setSavingLedger]   = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<GroupNode[]>("/api/accountancy/account-groups?withLedgers=1")
            .then((r) => {
                setTree(r.data);
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    return new Set(r.data.map((g) => g.id));
                });
            })
            .catch(() => toast.error("Failed to load account groups"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });

    const allFlat     = allGroupsFlat(tree);
    const flat        = flattenVisible(tree, expanded);
    const ledgerCount = countLedgers(tree);

    const startEditLedger = (l: LedgerRow) => {
        setEditLedgerId(l.id);
        setEditName(l.name);
        setEditGroupId(l.groupId);
    };

    const saveLedger = async (id: number) => {
        if (!editName.trim()) { toast.error("Name is required"); return; }
        setSavingLedger(true);
        try {
            await axios.patch(`/api/accountancy/ledgers/${id}`, {
                name:    editName.trim(),
                groupId: editGroupId,
            });
            toast.success("Ledger updated");
            setEditLedgerId(null);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to update ledger");
        } finally {
            setSavingLedger(false);
        }
    };

    const deleteLedger = async (l: LedgerRow) => {
        if (!confirm(`Delete ledger "${l.name}"?`)) return;
        try {
            await axios.delete(`/api/accountancy/ledgers/${l.id}`);
            toast.success("Ledger deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete ledger");
        }
    };

    const addLedger = async () => {
        if (!newForm.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            // normalBalance is left unset → inherited from the group's nature.
            await axios.post("/api/accountancy/ledgers", {
                name:          newForm.name.trim(),
                groupId:       newForm.groupId !== NONE ? Number(newForm.groupId) : null,
                description:   newForm.description.trim() || null,
            });
            toast.success("Ledger created");
            setShowAdd(false);
            setNewForm({ name: "", groupId: NONE, description: "" });
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to create ledger");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-6 px-6 pt-3 pb-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Ledgers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {allFlat.length} groups · {ledgerCount} ledgers — expand a group to see its ledgers
                    </p>
                </div>
                <Button onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={16} /> New Ledger
                </Button>
            </div>

            {/* Add ledger form */}
            {showAdd && (
                <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground">New Ledger Account</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Name <span className="text-destructive">*</span></Label>
                            <Input
                                value={newForm.name}
                                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Account name"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Under (Group)</Label>
                            <Select value={newForm.groupId} onValueChange={(v) => setNewForm((f) => ({ ...f, groupId: v }))}>
                                <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>No group</SelectItem>
                                    {allFlat.map((g) => (
                                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Normal Balance</Label>
                            {(() => {
                                const selectedGroup = allFlat.find((g) => String(g.id) === newForm.groupId);
                                return (
                                    <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                                        {selectedGroup
                                            ? `${inheritedNormalBalance(selectedGroup.type)} — inherited from ${selectedGroup.name}`
                                            : "Inherited from group"}
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Input
                                value={newForm.description}
                                onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="Optional"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                        <Button onClick={addLedger} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {/* Group tree table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
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
                                                : <span className="text-muted-foreground/50">—</span>}
                                        </td>

                                        {/* Balance (rolled up) */}
                                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                                            {g._count.accounts > 0
                                                ? <span className={g.totalBalance < 0 ? "text-destructive" : "text-foreground"}>
                                                    {drCr(g.totalBalance)}
                                                  </span>
                                                : <span className="text-muted-foreground/50">—</span>}
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
                            const l         = row.ledger;
                            const isEditing = editLedgerId === l.id;
                            const isIdentity = l.personId !== null || l.companyId !== null;
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
                                            {isEditing ? (
                                                <div className="space-y-1.5 w-72 max-w-full">
                                                    <Input
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        placeholder="Ledger name"
                                                        className="h-7 text-sm"
                                                        autoFocus
                                                    />
                                                    <GroupCombobox
                                                        value={editGroupId}
                                                        onChange={setEditGroupId}
                                                        groups={allFlat}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-foreground">{l.name}</span>
                                                    {l.code && (
                                                        <span className="font-mono text-xs text-muted-foreground/70">{l.code}</span>
                                                    )}
                                                    {isIdentity && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                            {l.personId ? "Customer" : "Company"}
                                                        </span>
                                                    )}
                                                    {!l.isActive && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </div>
                                            )}
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
                                            : <span className="text-muted-foreground/50">0.00</span>}
                                    </td>

                                    {/* Edit / save / cancel */}
                                    <td className="px-4 py-2 text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            {isEditing ? (
                                                <>
                                                    <Button
                                                        variant="ghost" size="icon-sm"
                                                        className="text-green-600 hover:bg-green-50"
                                                        onClick={() => saveLedger(l.id)}
                                                        disabled={savingLedger}
                                                        aria-label="Save"
                                                    >
                                                        {savingLedger ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon-sm"
                                                        className="text-muted-foreground hover:bg-muted"
                                                        onClick={() => setEditLedgerId(null)}
                                                        aria-label="Cancel"
                                                    >
                                                        <X size={14} />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="ghost" size="icon-sm"
                                                        className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                        onClick={() => startEditLedger(l)}
                                                        aria-label={`Edit ${l.name}`}
                                                    >
                                                        <Pencil size={14} />
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon-sm"
                                                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                        onClick={() => deleteLedger(l)}
                                                        disabled={isIdentity}
                                                        aria-label={`Delete ${l.name}`}
                                                    >
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
                                    No groups found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            </div>
        </ScrollArea>
    );
}
