"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, GL_TYPE_COLORS, GL_TYPE_ORDER, type GlAccountType } from "@/utils/constants";

type NormalBalance = "DEBIT" | "CREDIT";

interface GlAccount {
    id: number;
    code: string;
    name: string;
    type: GlAccountType;
    normalBalance: NormalBalance;
    description: string | null;
    isActive: boolean;
    balance: number;
    group: { id: number; name: string } | null;
    _count: { lines: number };
}

const cellClass = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function ChartOfAccountsPage() {
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [saving, setSaving] = useState(false);

    const [newForm, setNewForm] = useState({
        code: "", name: "", type: "ASSET" as GlAccountType,
        normalBalance: "DEBIT" as NormalBalance, description: "",
    });

    const load = () => {
        setLoading(true);
        axios.get<GlAccount[]>("/api/finance/gl-accounts?activeOnly=false")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const grouped = GL_TYPE_ORDER.map((type) => ({
        type,
        rows: accounts.filter((a) => a.type === type),
    }));

    const startEdit = (a: GlAccount) => {
        setEditingId(a.id);
        setEditName(a.name);
        setEditDesc(a.description ?? "");
    };

    const saveEdit = async (id: number) => {
        setSaving(true);
        try {
            await axios.patch(`/api/finance/gl-accounts/${id}`, { name: editName, description: editDesc });
            toast.success("Updated");
            setEditingId(null);
            load();
        } catch {
            toast.error("Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (a: GlAccount) => {
        if (a.isActive) {
            try {
                await axios.delete(`/api/finance/gl-accounts/${a.id}`);
                toast.success("Deactivated");
                load();
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                toast.error(msg ?? "Failed");
            }
        } else {
            await axios.patch(`/api/finance/gl-accounts/${a.id}`, { isActive: true });
            toast.success("Activated");
            load();
        }
    };

    const addAccount = async () => {
        if (!newForm.code || !newForm.name) { toast.error("Code and name required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/finance/gl-accounts", newForm);
            toast.success("Account created");
            setShowAdd(false);
            setNewForm({ code: "", name: "", type: "ASSET", normalBalance: "DEBIT", description: "" });
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to create account");
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Chart of Accounts</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">General Ledger master list</p>
                </div>
                <Button onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={16} /> New Account
                </Button>
            </div>

            {/* Add form */}
            {showAdd && (
                <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground">New GL Account</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Code</Label>
                            <Input
                                value={newForm.code}
                                onChange={(e) => setNewForm((f) => ({ ...f, code: e.target.value }))}
                                placeholder="e.g. 1100"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input
                                value={newForm.name}
                                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Account name"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Type</Label>
                            <Select
                                value={newForm.type}
                                onValueChange={(t) => {
                                    const nb: NormalBalance = ["ASSET", "EXPENSE"].includes(t) ? "DEBIT" : "CREDIT";
                                    setNewForm((f) => ({ ...f, type: t as GlAccountType, normalBalance: nb }));
                                }}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {GL_TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Normal Balance</Label>
                            <Select
                                value={newForm.normalBalance}
                                onValueChange={(v) => setNewForm((f) => ({ ...f, normalBalance: v as NormalBalance }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEBIT">DEBIT</SelectItem>
                                    <SelectItem value="CREDIT">CREDIT</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="col-span-2 space-y-1.5">
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
                        <Button onClick={addAccount} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {/* Account groups */}
            {grouped.map(({ type, rows }) => rows.length === 0 ? null : (
                <div key={type} className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <div className={`flex items-center justify-between border-b border-border px-5 py-3 ${GL_TYPE_COLORS[type]}`}>
                        <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 border border-current/20 ${GL_TYPE_COLORS[type]}`}>{type}</span>
                        <span className="text-xs opacity-70">{rows.length} accounts</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <th className="px-5 py-2 text-left font-medium">Code</th>
                                <th className="px-5 py-2 text-left font-medium">Name</th>
                                <th className="px-5 py-2 text-left font-medium">Group</th>
                                <th className="px-5 py-2 text-left font-medium">Normal Balance</th>
                                <th className="px-5 py-2 text-right font-medium">Current Balance</th>
                                <th className="px-5 py-2 text-right font-medium">Entries</th>
                                <th className="px-5 py-2 text-center font-medium">Status</th>
                                <th className="px-5 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((a) => (
                                <tr key={a.id} className={`border-b last:border-0 hover:bg-muted/40 ${!a.isActive ? "opacity-50" : ""}`}>
                                    <td className="px-5 py-3 font-mono text-foreground">{a.code}</td>
                                    <td className="px-5 py-3">
                                        {editingId === a.id ? (
                                            <input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className={cellClass}
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="font-medium text-foreground">{a.name}</span>
                                        )}
                                        {a.description && editingId !== a.id && (
                                            <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                                        )}
                                        {editingId === a.id && (
                                            <input
                                                value={editDesc}
                                                onChange={(e) => setEditDesc(e.target.value)}
                                                className={`${cellClass} mt-1`}
                                                placeholder="Description"
                                            />
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs text-muted-foreground">
                                            {a.group?.name ?? <span className="italic text-muted-foreground/50">—</span>}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs text-muted-foreground">{a.normalBalance}</span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono">
                                        <span className={a.balance < 0 ? "text-destructive" : "text-foreground"}>
                                            {a.balance < 0 && <TrendingDown size={12} className="inline mr-1" />}
                                            {a.balance > 0 && <TrendingUp size={12} className="inline mr-1 text-green-500" />}
                                            {fmt(a.balance)}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right text-muted-foreground">{a._count.lines}</td>
                                    <td className="px-5 py-3 text-center">
                                        <span className={`text-xs px-2 py-0.5 border font-medium ${a.isActive ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>
                                            {a.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            {editingId === a.id ? (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        onClick={() => saveEdit(a.id)}
                                                        className="text-green-600 hover:bg-green-50"
                                                        disabled={saving}
                                                    >
                                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        onClick={() => setEditingId(null)}
                                                        className="text-muted-foreground hover:bg-muted"
                                                    >
                                                        <X size={14} />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        onClick={() => startEdit(a)}
                                                        className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                    >
                                                        <Pencil size={14} />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        onClick={() => toggleActive(a)}
                                                        className={`text-xs ${a.isActive ? "text-destructive hover:bg-destructive/10" : "text-green-600 hover:bg-green-50"}`}
                                                    >
                                                        {a.isActive ? <X size={14} /> : <Check size={14} />}
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
}
