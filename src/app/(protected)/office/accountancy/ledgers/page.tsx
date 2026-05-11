"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Loader2, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";

type GroupType  = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type GlType     = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

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
}

interface FlatRow extends Omit<GroupNode, "children"> {
    depth: number;
    hasChildren: boolean;
}

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME:    "bg-green-50 text-green-700 border-green-200",
    EXPENSE:   "bg-red-50 text-red-700 border-red-200",
};

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

function drCr(balance: number): string {
    if (balance === 0) return "0.00";
    const abs = fmt(Math.abs(balance));
    return balance > 0 ? `${abs} Dr` : `${abs} Cr`;
}

const NONE = "none";

export default function LedgersPage() {
    const router = useRouter();

    const [tree, setTree]         = useState<GroupNode[]>([]);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading]   = useState(true);
    const [showAdd, setShowAdd]   = useState(false);
    const [saving, setSaving]     = useState(false);

    const [newForm, setNewForm] = useState({
        name: "", groupId: NONE, code: "", description: "",
        type: NONE, normalBalance: NONE,
    });

    const load = useCallback(() => {
        setLoading(true);
        axios.get<GroupNode[]>("/api/accountancy/account-groups")
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

    const allFlat = allGroupsFlat(tree);
    const flat    = flattenVisible(tree, expanded);

    const addLedger = async () => {
        if (!newForm.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/accountancy/ledgers", {
                name:          newForm.name.trim(),
                groupId:       newForm.groupId !== NONE ? Number(newForm.groupId) : null,
                code:          newForm.code.trim() || null,
                description:   newForm.description.trim() || null,
                type:          newForm.type !== NONE ? newForm.type : null,
                normalBalance: newForm.normalBalance !== NONE ? newForm.normalBalance : null,
            });
            toast.success("Ledger created");
            setShowAdd(false);
            setNewForm({ name: "", groupId: NONE, code: "", description: "", type: NONE, normalBalance: NONE });
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
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Ledgers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {allFlat.length} groups — click a group to view its accounts
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
                            <Label>Code</Label>
                            <Input
                                value={newForm.code}
                                onChange={(e) => setNewForm((f) => ({ ...f, code: e.target.value }))}
                                placeholder="e.g. 1100"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Type</Label>
                            <Select value={newForm.type} onValueChange={(v) => setNewForm((f) => ({ ...f, type: v }))}>
                                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— none —</SelectItem>
                                    {(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as GlType[]).map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Normal Balance</Label>
                            <Select value={newForm.normalBalance} onValueChange={(v) => setNewForm((f) => ({ ...f, normalBalance: v }))}>
                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— none —</SelectItem>
                                    <SelectItem value="DEBIT">Debit</SelectItem>
                                    <SelectItem value="CREDIT">Credit</SelectItem>
                                </SelectContent>
                            </Select>
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
                        {flat.map((row) => (
                            <tr
                                key={row.id}
                                className="border-b last:border-0 hover:bg-muted/40"
                            >
                                {/* Expand chevron */}
                                <td className="px-2 py-2.5 text-center w-8">
                                    {row.hasChildren ? (
                                        <button
                                            onClick={() => toggle(row.id)}
                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            {expanded.has(row.id)
                                                ? <ChevronDown size={14} />
                                                : <ChevronRight size={14} />}
                                        </button>
                                    ) : null}
                                </td>

                                {/* Name (indented by depth) */}
                                <td className="py-2.5 pr-4">
                                    <div style={{ paddingLeft: row.depth * 20 }}>
                                        <span className={`font-medium ${row.depth === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                            {row.name}
                                        </span>
                                    </div>
                                </td>

                                {/* Type badge */}
                                <td className="px-4 py-2.5">
                                    <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[row.type]}`}>
                                        {row.type}
                                    </span>
                                </td>

                                {/* Account count */}
                                <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                    {row._count.accounts > 0
                                        ? <span className="font-medium text-foreground">{row._count.accounts}</span>
                                        : <span className="text-muted-foreground/50">—</span>}
                                </td>

                                {/* Balance */}
                                <td className="px-4 py-2.5 text-right font-mono text-xs">
                                    {row._count.accounts > 0
                                        ? <span className={row.totalBalance < 0 ? "text-destructive" : "text-foreground"}>
                                            {drCr(row.totalBalance)}
                                          </span>
                                        : <span className="text-muted-foreground/50">—</span>}
                                </td>

                                {/* View accounts link */}
                                <td className="px-4 py-2.5 text-right">
                                    {row._count.accounts > 0 && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1"
                                            onClick={() => router.push(`/office/accountancy/ledgers/${row.id}`)}
                                        >
                                            View <ArrowRight size={12} />
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        ))}
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
    );
}
