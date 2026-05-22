"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Pencil, Trash2, Loader2, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

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
    const [showAdd, setShowAdd]   = useState(false);
    const [saving, setSaving]     = useState(false);

    // Add form state — "none" sentinel used instead of "" (SelectItem disallows empty string)
    const [newName, setNewName]         = useState("");
    const [newType, setNewType]         = useState<GroupType>("ASSET");
    const [newParent, setNewParent]     = useState<string>("none");
    const [newSort, setNewSort]         = useState("0");

    // Edit state
    const [editId, setEditId]           = useState<number | null>(null);
    const [editName, setEditName]       = useState("");
    const [editParent, setEditParent]   = useState<string>("none");
    const [editSort, setEditSort]       = useState("0");

    const load = useCallback(() => {
        setLoading(true);
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

    const flat    = flattenVisible(tree, expanded);
    const allFlat = allGroupsFlat(tree);

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });

    const addGroup = async () => {
        if (!newName.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/accountancy/account-groups", {
                name:      newName.trim(),
                type:      newType,
                parentId:  newParent !== "none" ? Number(newParent) : null,
                sortOrder: Number(newSort) || 0,
            });
            toast.success("Group created");
            setShowAdd(false);
            setNewName(""); setNewType("ASSET"); setNewParent("none"); setNewSort("0");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to create group");
        } finally {
            setSaving(false);
        }
    };

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
        if (!confirm(`Delete group "${name}"?`)) return;
        try {
            await axios.delete(`/api/accountancy/account-groups/${id}`);
            toast.success("Deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete");
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Account Groups</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Multi Group Alteration — {allFlat.length} groups
                    </p>
                </div>
                <Button onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={16} /> New Group
                </Button>
            </div>

            {/* Add form */}
            {showAdd && (() => {
                const newParentGroup = newParent !== "none" ? allFlat.find((g) => g.id === Number(newParent)) : null;
                const effectiveType  = newParentGroup ? newParentGroup.type : newType;
                return (
                <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground">New Account Group</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name" autoFocus />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Under (parent group)</Label>
                            <Select value={newParent} onValueChange={setNewParent}>
                                <SelectTrigger><SelectValue placeholder="Primary (no parent)" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Primary (no parent)</SelectItem>
                                    {allFlat.map((g) => (
                                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Type</Label>
                            {newParentGroup ? (
                                <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted text-sm text-muted-foreground">
                                    <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[effectiveType]}`}>
                                        {TYPE_LABELS[effectiveType]}
                                    </span>
                                    <span className="text-xs">inherited from parent</span>
                                </div>
                            ) : (
                                <Select value={newType} onValueChange={(v) => setNewType(v as GroupType)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ASSET">Asset</SelectItem>
                                        <SelectItem value="LIABILITY">Liability</SelectItem>
                                        <SelectItem value="INCOME">Income</SelectItem>
                                        <SelectItem value="EXPENSE">Expense</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Sort Order</Label>
                            <Input type="text" inputMode="numeric" value={newSort} onChange={(e) => setNewSort(e.target.value)} placeholder="0" />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                        <Button onClick={addGroup} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
                );
            })()}

            {/* Group tree table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
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
                                    No groups yet. Click &quot;New Group&quot; to create one.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
