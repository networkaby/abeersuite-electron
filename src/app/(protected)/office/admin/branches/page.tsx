"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Building2, MapPin, Phone, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Branch {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
    _count: { users: number; departments: number };
}

const EMPTY = { id: "", name: "", address: "", phone: "", isActive: true };

export default function BranchesPage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);

    const loadBranches = async () => {
        try {
            const res = await axios.get<Branch[]>("/api/branches");
            setBranches(res.data);
        } catch { toast.error("Failed to load branches"); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadBranches(); }, []);

    const startAdd = () => { setForm(EMPTY); setEditId(null); setAddingNew(true); };
    const startEdit = (b: Branch) => { setForm({ id: b.id, name: b.name, address: b.address ?? "", phone: b.phone ?? "", isActive: b.isActive }); setEditId(b.id); setAddingNew(false); };
    const cancel = () => { setAddingNew(false); setEditId(null); };

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (addingNew && !form.id.trim()) { toast.error("ID is required"); return; }
        setSaving(true);
        try {
            if (addingNew) {
                await axios.post("/api/branches", { ...form, id: form.id.toUpperCase() });
                toast.success("Branch created");
            } else {
                const body: Record<string, unknown> = { name: form.name, address: form.address || null, phone: form.phone || null, isActive: form.isActive };
                if (form.id.trim().toUpperCase() !== editId) body.id = form.id.trim().toUpperCase();
                await axios.patch(`/api/branches/${editId}`, body);
                toast.success("Branch updated");
            }
            cancel();
            loadBranches();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save branch");
        } finally { setSaving(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this branch?")) return;
        try {
            await axios.delete(`/api/branches/${id}`);
            toast.success("Branch deleted");
            loadBranches();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete branch");
        }
    };

    const handleToggleActive = async (b: Branch) => {
        try {
            await axios.patch(`/api/branches/${b.id}`, { isActive: !b.isActive });
            toast.success(b.isActive ? "Branch deactivated" : "Branch activated");
            loadBranches();
        } catch { toast.error("Failed to update branch"); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Building2 size={28} /> Branches
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Physical and virtual locations of your organisation</p>
                </div>
                <Button onClick={startAdd} disabled={addingNew}>
                    <Plus size={16} /> New Branch
                </Button>
            </div>

            {/* New branch inline form */}
            {addingNew && (
                <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                    <p className="text-sm font-semibold">New Branch</p>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">ID (e.g. BR-NYC) *</label>
                            <Input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value.toUpperCase() }))} placeholder="BR-HQ" className="mt-1 font-mono uppercase" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Name *</label>
                            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Head Office" className="mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Address</label>
                            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, Dhaka" className="mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Phone</label>
                            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+880 1xxx-xxxxxx" className="mt-1" />
                        </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <Button onClick={handleSave} disabled={saving} size="sm"><Check size={14} /> Save</Button>
                        <Button variant="outline" size="sm" onClick={cancel}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="space-y-2">
                    {branches.length === 0 && !addingNew && (
                        <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border">No branches yet. Create one above.</p>
                    )}
                    {branches.map(b => (
                        <div key={b.id} className={`rounded-lg border border-border border-l-4 ${b.isActive ? "border-l-primary" : "border-l-muted-foreground opacity-60"} bg-card`}>
                            {editId === b.id ? (
                                <div className="p-4 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">ID</label>
                                            <Input
                                                value={form.id}
                                                onChange={e => setForm(f => ({ ...f, id: e.target.value.toUpperCase() }))}
                                                className="mt-1 font-mono uppercase"
                                            />
                                            {form.id.trim().toUpperCase() !== editId && form.id.trim() !== "" && (
                                                <p className="text-[10px] text-amber-600 mt-0.5">
                                                    Renaming ID — all linked departments, positions and inventory will cascade automatically.
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Name *</label>
                                            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Address</label>
                                            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="mt-1" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Phone</label>
                                            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={handleSave} disabled={saving}><Check size={14} /> Save</Button>
                                        <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 px-4 py-3">
                                    <div className="shrink-0">
                                        <Badge className="font-mono text-xs">{b.id}</Badge>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm">{b.name}</p>
                                        <div className="flex gap-3 mt-0.5">
                                            {b.address && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin size={10} />{b.address}</span>}
                                            {b.phone   && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={10} />{b.phone}</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs text-muted-foreground">{b._count.users} users · {b._count.departments} depts</span>
                                        <Badge className={b.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                                            {b.isActive ? "Active" : "Inactive"}
                                        </Badge>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="icon-sm" title={b.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggleActive(b)}>
                                                {b.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                            </Button>
                                            <Button variant="outline" size="icon-sm" onClick={() => startEdit(b)}><Pencil size={14} /></Button>
                                            <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(b.id)}><Trash2 size={14} /></Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
