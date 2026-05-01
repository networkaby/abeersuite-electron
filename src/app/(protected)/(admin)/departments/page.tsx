"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Branch { id: string; name: string; }
interface Department {
    id: string;
    name: string;
    description: string | null;
    branchId: string | null;
    branch: Branch | null;
    _count: { users: number };
}

type FormState = { id: string; name: string; description: string; branchId: string };
const EMPTY: FormState = { id: "", name: "", description: "", branchId: "" };

function DeptFormFields({
    addingNew, form, branches, onChange,
}: {
    addingNew: boolean;
    form: FormState;
    branches: Branch[];
    onChange: (f: FormState) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {addingNew && (
                <div className="col-span-2 grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">ID (e.g. DEP-ENG) *</label>
                        <Input
                            value={form.id}
                            onChange={e => onChange({ ...form, id: e.target.value.toUpperCase() })}
                            placeholder="DEP-REPAIR"
                            className="mt-1 font-mono uppercase"
                        />
                    </div>
                </div>
            )}
            <div>
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                    value={form.name}
                    onChange={e => onChange({ ...form, name: e.target.value })}
                    placeholder="Engineering"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">
                    Branch scope <span className="font-normal text-muted-foreground">(leave blank = cross-branch)</span>
                </label>
                <select
                    value={form.branchId}
                    onChange={e => onChange({ ...form, branchId: e.target.value })}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                    <option value="">— All branches —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </div>
            <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Input
                    value={form.description}
                    onChange={e => onChange({ ...form, description: e.target.value })}
                    placeholder="What does this department do?"
                    className="mt-1"
                />
            </div>
        </div>
    );
}

export default function DepartmentsPage() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY);
    const [saving, setSaving] = useState(false);

    const fetchAll = async () => {
        try {
            const [dRes, bRes] = await Promise.all([
                axios.get<Department[]>("/api/departments"),
                axios.get<Branch[]>("/api/branches"),
            ]);
            setDepartments(dRes.data);
            setBranches(bRes.data);
        } catch { toast.error("Failed to load data"); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchAll(); }, []);

    const startAdd = () => { setForm(EMPTY); setEditId(null); setAddingNew(true); };
    const startEdit = (d: Department) => {
        setForm({ id: d.id, name: d.name, description: d.description ?? "", branchId: d.branchId ?? "" });
        setEditId(d.id); setAddingNew(false);
    };
    const cancel = () => { setAddingNew(false); setEditId(null); };

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (addingNew && !form.id.trim()) { toast.error("ID is required"); return; }
        setSaving(true);
        try {
            const payload = {
                name:        form.name,
                description: form.description || null,
                branchId:    form.branchId || null,
            };
            if (addingNew) {
                await axios.post("/api/departments", { ...payload, id: form.id.toUpperCase() });
                toast.success("Department created");
            } else {
                await axios.patch(`/api/departments/${editId}`, payload);
                toast.success("Department updated");
            }
            cancel();
            fetchAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save department");
        } finally { setSaving(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this department?")) return;
        try {
            await axios.delete(`/api/departments/${id}`);
            toast.success("Department deleted");
            fetchAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete department");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Layers size={28} /> Departments
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Functional groupings — assign users to departments to define their domain</p>
                </div>
                <Button onClick={startAdd} disabled={addingNew}>
                    <Plus size={16} /> New Department
                </Button>
            </div>

            {addingNew && (
                <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                    <p className="text-sm font-semibold">New Department</p>
                    <DeptFormFields addingNew={true} form={form} branches={branches} onChange={setForm} />
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
                    {departments.length === 0 && !addingNew && (
                        <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border">No departments yet. Create one above.</p>
                    )}
                    {departments.map(d => (
                        <div key={d.id} className="border-l-primary rounded-lg border border-border border-l-4 bg-card">
                            {editId === d.id ? (
                                <div className="p-4 space-y-3">
                                    <DeptFormFields addingNew={false} form={form} branches={branches} onChange={setForm} />
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={handleSave} disabled={saving}><Check size={14} /> Save</Button>
                                        <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 px-4 py-3">
                                    <Badge className="font-mono text-xs shrink-0">{d.id}</Badge>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm">{d.name}</p>
                                        {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <Badge className="bg-muted text-muted-foreground text-xs">
                                            {d.branch ? d.branch.name : "All branches"}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">{d._count.users} users</span>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="icon-sm" onClick={() => startEdit(d)}><Pencil size={14} /></Button>
                                            <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(d.id)}><Trash2 size={14} /></Button>
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
