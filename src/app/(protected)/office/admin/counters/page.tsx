"use client";

// /office/admin/counters — POS counter management
//
// List every POS counter across every branch, create new counters
// (auto-creates the till GL account), rename, set default float,
// activate/deactivate, or delete (only if no shifts have ever used it).

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Plus, Pencil, Trash2, X, Check, Monitor, Building2, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";

type Branch = { id: string; name: string; isActive: boolean };

type Counter = {
    id: number;
    name: string;
    branchId: string;
    branch: { id: string; name: string };
    isActive: boolean;
    tillAccount: { id: number; name: string; balance: string };
    totalShifts: number;
    activeShift: { id: number; status: string; user: { name: string } } | null;
};

const EMPTY_FORM = { branchId: "", name: "" };

export default function CountersAdminPage() {
    const [counters, setCounters] = useState<Counter[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading]   = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId]     = useState<number | null>(null);
    const [form, setForm]         = useState(EMPTY_FORM);
    const [editForm, setEditForm] = useState({ name: "" });
    const [saving, setSaving]     = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [cRes, bRes] = await Promise.all([
                axios.get<Counter[]>("/api/pos/counters?scope=all"),
                axios.get<Branch[]>("/api/branches"),
            ]);
            setCounters(cRes.data);
            setBranches(bRes.data.filter((b) => b.isActive !== false));
        } catch {
            toast.error("Failed to load counters");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);

    const startAdd = () => {
        setForm({ ...EMPTY_FORM, branchId: branches[0]?.id ?? "" });
        setEditId(null);
        setAddingNew(true);
    };
    const startEdit = (c: Counter) => {
        setEditForm({ name: c.name });
        setEditId(c.id);
        setAddingNew(false);
    };
    const cancel = () => { setAddingNew(false); setEditId(null); };

    const handleCreate = async () => {
        if (!form.branchId)    { toast.error("Pick a branch"); return; }
        if (!form.name.trim()) { toast.error("Counter name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/pos/counters", {
                branchId: form.branchId,
                name:     form.name.trim(),
            });
            toast.success("Counter created");
            cancel();
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to create counter" : "Failed to create counter");
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (editId == null) return;
        if (!editForm.name.trim()) { toast.error("Counter name is required"); return; }
        setSaving(true);
        try {
            await axios.patch(`/api/pos/counters/${editId}`, {
                name: editForm.name.trim(),
            });
            toast.success("Counter updated");
            cancel();
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to update" : "Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (c: Counter) => {
        try {
            await axios.patch(`/api/pos/counters/${c.id}`, { isActive: !c.isActive });
            toast.success(c.isActive ? "Counter deactivated" : "Counter activated");
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to toggle" : "Failed to toggle");
        }
    };

    const handleDelete = async (c: Counter) => {
        if (!confirm(`Delete counter "${c.name}" (${c.branch.name})? Till account will be unlinked but kept for audit.`)) return;
        try {
            await axios.delete(`/api/pos/counters/${c.id}`);
            toast.success("Counter deleted");
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to delete" : "Failed to delete");
        }
    };

    // Group counters by branch for display.
    const byBranch = counters.reduce<Record<string, Counter[]>>((acc, c) => {
        (acc[c.branch.name] ||= []).push(c);
        return acc;
    }, {});

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Monitor size={28} /> POS Counters
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Physical billing stations. Each counter has its own GL till account; any cashier can work it.
                    </p>
                </div>
                <Button onClick={startAdd} disabled={addingNew || branches.length === 0}>
                    <Plus size={16} /> New Counter
                </Button>
            </div>

            {/* Create form */}
            {addingNew && (
                <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                    <p className="text-sm font-semibold">New Counter</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Branch *</label>
                            <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Select branch…" /></SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Name *</label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Counter 2"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Creates GL account <span className="font-mono">Cash – {form.name || "<Name>"} – {branches.find((b) => b.id === form.branchId)?.name ?? "<Branch>"}</span> under Cash-in-Hand.
                    </p>
                    <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleCreate} disabled={saving}><Check size={14} /> Save</Button>
                        <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            )}

            {/* List grouped by branch */}
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : counters.length === 0 && !addingNew ? (
                <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border rounded-lg">
                    No counters yet. Create one above.
                </p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(byBranch).map(([branchName, list]) => (
                        <section key={branchName} className="space-y-2">
                            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                                <Building2 size={14} /> {branchName}
                            </h2>
                            <div className="space-y-2">
                                {list.map((c) => (
                                    <div
                                        key={c.id}
                                        className={`rounded-lg border border-border border-l-4 ${
                                            c.isActive ? "border-l-primary" : "border-l-muted-foreground opacity-60"
                                        } bg-card`}
                                    >
                                        {editId === c.id ? (
                                            <div className="p-4 space-y-3">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Name *</label>
                                                        <Input
                                                            value={editForm.name}
                                                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Renaming the counter also renames its till GL account.
                                                </p>
                                                <div className="flex gap-2">
                                                    <Button size="sm" onClick={handleUpdate} disabled={saving}><Check size={14} /> Save</Button>
                                                    <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-4 px-4 py-3 flex-wrap">
                                                <div className="shrink-0">
                                                    <Badge className="font-mono text-xs"><Monitor size={11} className="mr-1" />{c.name}</Badge>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-mono text-muted-foreground truncate">
                                                        {c.tillAccount.name}
                                                    </p>
                                                    <div className="flex gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                                        <span>Balance ₹{fmt(Number(c.tillAccount.balance))}</span>
                                                        <span>{c.totalShifts} shift{c.totalShifts === 1 ? "" : "s"}</span>
                                                        {c.activeShift && (
                                                            <span className="text-amber-700 dark:text-amber-400">
                                                                · {c.activeShift.status === "AWAITING_HANDOVER" ? "awaiting handover" : `in use — ${c.activeShift.user.name}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Badge className={c.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                                                        {c.isActive ? "Active" : "Inactive"}
                                                    </Badge>
                                                    <div className="flex gap-1">
                                                        <Button variant="outline" size="icon-sm" title={c.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggle(c)}>
                                                            {c.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                                        </Button>
                                                        <Button variant="outline" size="icon-sm" onClick={() => startEdit(c)}><Pencil size={14} /></Button>
                                                        <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(c)} title="Delete (only if no shifts)">
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
