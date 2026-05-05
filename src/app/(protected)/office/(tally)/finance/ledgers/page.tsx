"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Loader2, Check, X, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";

type GlType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type NormalBalance = "DEBIT" | "CREDIT";

interface GroupOption {
    id: number;
    name: string;
    type: GroupType;
}

interface GroupNode extends GroupOption {
    children: GroupNode[];
}

interface Ledger {
    id: number;
    name: string;
    code: string | null;
    type: GlType | null;
    normalBalance: NormalBalance | null;
    description: string | null;
    isActive: boolean;
    balance: number;
    groupId: number | null;
    customerId: number | null;
    companyId: number | null;
    group: { id: number; name: string; type: string } | null;
    _count: { lines: number };
}

const GL_TYPE_COLORS: Record<GlType, string> = {
    ASSET:     "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    EQUITY:    "bg-amber-50 text-amber-700 border-amber-200",
    REVENUE:   "bg-green-50 text-green-700 border-green-200",
    EXPENSE:   "bg-red-50 text-red-700 border-red-200",
};

function flatGroups(nodes: GroupNode[]): GroupOption[] {
    const result: GroupOption[] = [];
    for (const n of nodes) {
        result.push({ id: n.id, name: n.name, type: n.type });
        result.push(...flatGroups(n.children));
    }
    return result;
}

function drCr(balance: number, normalBalance: NormalBalance | null): string {
    if (balance === 0) return "0.00";
    const sign = balance < 0
        ? (normalBalance === "DEBIT" ? "Cr" : "Dr")
        : (normalBalance === "DEBIT" ? "Dr" : "Cr");
    return `${fmt(Math.abs(balance))} ${sign}`;
}

// "none" sentinel replaces "" throughout — shadcn SelectItem forbids empty string values
const NONE = "none";

const cellClass = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function LedgersPage() {
    const [ledgers, setLedgers]     = useState<Ledger[]>([]);
    const [groups, setGroups]       = useState<GroupOption[]>([]);
    const [loading, setLoading]     = useState(true);
    const [filterGroup, setFilterGroup] = useState<string>(NONE);
    const [showAdd, setShowAdd]     = useState(false);
    const [saving, setSaving]       = useState(false);
    const [editId, setEditId]       = useState<number | null>(null);

    const [newForm, setNewForm] = useState({
        name: "", groupId: NONE, code: "", description: "",
        type: NONE, normalBalance: NONE,
    });
    const [editGroupId, setEditGroupId] = useState<string>(NONE);

    const loadGroups = useCallback(() => {
        axios.get<GroupNode[]>("/api/finance/account-groups")
            .then((r) => setGroups(flatGroups(r.data)))
            .catch(() => { /* silent */ });
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        const params = new URLSearchParams({ activeOnly: "false" });
        if (filterGroup !== NONE) params.set("groupId", filterGroup);
        axios.get<Ledger[]>(`/api/finance/ledgers?${params}`)
            .then((r) => setLedgers(r.data))
            .catch(() => toast.error("Failed to load ledgers"))
            .finally(() => setLoading(false));
    }, [filterGroup]);

    useEffect(() => { loadGroups(); }, [loadGroups]);
    useEffect(() => { load(); }, [load]);

    const addLedger = async () => {
        if (!newForm.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/finance/ledgers", {
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

    const saveGroup = async (id: number) => {
        setSaving(true);
        try {
            await axios.patch(`/api/finance/ledgers/${id}`, {
                groupId: editGroupId !== NONE ? Number(editGroupId) : null,
            });
            toast.success("Group updated");
            setEditId(null);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
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
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Ledgers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Multi Ledger Alteration — {ledgers.length} accounts
                    </p>
                </div>
                <Button onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={16} /> New Ledger
                </Button>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-3">
                <Label className="text-sm text-muted-foreground shrink-0">Filter by group:</Label>
                <Select value={filterGroup} onValueChange={setFilterGroup}>
                    <SelectTrigger className="w-56">
                        <SelectValue placeholder="All groups" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE}>All groups</SelectItem>
                        {groups.map((g) => (
                            <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Add form */}
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
                                    {groups.map((g) => (
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

            {/* Ledger table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <th className="px-4 py-2.5 text-left font-medium w-12">S.No.</th>
                            <th className="px-4 py-2.5 text-left font-medium">Name of Ledger</th>
                            <th className="px-4 py-2.5 text-left font-medium w-44">Under</th>
                            <th className="px-4 py-2.5 text-left font-medium w-28">Type</th>
                            <th className="px-4 py-2.5 text-right font-medium w-36">Balance</th>
                            <th className="px-4 py-2.5 text-center font-medium w-20">Status</th>
                            <th className="px-4 py-2.5 w-20" />
                        </tr>
                    </thead>
                    <tbody>
                        {ledgers.map((l, i) => {
                            const isEditing  = editId === l.id;
                            const isIdentity = l.customerId !== null || l.companyId !== null;
                            return (
                                <tr key={l.id} className={`border-b last:border-0 hover:bg-muted/40 ${!l.isActive ? "opacity-50" : ""}`}>
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{i + 1}.</td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-foreground">{l.name}</span>
                                            {l.code && <span className="text-xs font-mono text-muted-foreground">{l.code}</span>}
                                            {isIdentity && (
                                                <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                    {l.customerId ? "Customer" : "Company"}
                                                </span>
                                            )}
                                        </div>
                                        {l.description && <p className="text-xs text-muted-foreground mt-0.5">{l.description}</p>}
                                    </td>
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                                        {isEditing ? (
                                            <Select value={editGroupId} onValueChange={setEditGroupId}>
                                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="No group" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={NONE}>No group</SelectItem>
                                                    {groups.map((g) => (
                                                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            l.group?.name ?? <span className="italic text-muted-foreground/60">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        {l.type && (
                                            <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${GL_TYPE_COLORS[l.type]}`}>
                                                {l.type}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-sm">
                                        {l.balance !== 0 && (
                                            l.balance > 0
                                                ? <TrendingUp size={11} className="inline mr-1 text-green-500" />
                                                : <TrendingDown size={11} className="inline mr-1 text-destructive" />
                                        )}
                                        <span className={l.balance < 0 ? "text-destructive" : "text-foreground"}>
                                            {drCr(l.balance, l.normalBalance)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                        <span className={`text-xs px-2 py-0.5 border font-medium ${l.isActive ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>
                                            {l.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            {isEditing ? (
                                                <>
                                                    <Button variant="ghost" size="icon-sm" className="text-green-600 hover:bg-green-50"
                                                        onClick={() => saveGroup(l.id)} disabled={saving}>
                                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                    </Button>
                                                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-muted"
                                                        onClick={() => setEditId(null)}>
                                                        <X size={14} />
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button variant="ghost" size="icon-sm"
                                                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                    onClick={() => {
                                                        setEditId(l.id);
                                                        setEditGroupId(l.groupId ? String(l.groupId) : NONE);
                                                    }}>
                                                    <Pencil size={14} />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {ledgers.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                    No ledgers found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
