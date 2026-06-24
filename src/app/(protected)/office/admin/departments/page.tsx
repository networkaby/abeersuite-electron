"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Layers, KeyRound, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Branch { id: string; name: string; }
interface Permission {
    id: string;
    label: string;
    module: string;
    description?: string | null;
}
interface Department {
    id: string;
    name: string;
    description: string | null;
    branchId: string | null;
    isAllAccess: boolean;
    branch: Branch | null;
    // users      = unique holders of any position in this dept
    // positions  = total positions referencing this dept
    // branches   = unique branches that have positions in this dept (org-wide reach)
    // permissionPool = permissions in this department's authoring lens
    // roles      = roles homed in this department
    _count: { users: number; positions: number; branches: number; permissionPool: number; roles: number };
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
                <Select value={form.branchId || "all-branches"} onValueChange={(value) => onChange({ ...form, branchId: value === "all-branches" ? "" : value })}>
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All branches" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all-branches">All branches</SelectItem>
                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                </Select>
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
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY);
    const [saving, setSaving] = useState(false);

    // Permission-pool editor state (which dept's pool is open, and its working set).
    const [poolEditId, setPoolEditId] = useState<string | null>(null);
    const [poolSelected, setPoolSelected] = useState<Set<string>>(new Set());
    const [poolOriginal, setPoolOriginal] = useState<Set<string>>(new Set());
    const [poolSaving, setPoolSaving] = useState(false);

    const fetchAll = async () => {
        try {
            const [dRes, bRes, pRes] = await Promise.all([
                axios.get<Department[]>("/api/departments"),
                axios.get<Branch[]>("/api/branches"),
                axios.get<Permission[]>("/api/permissions"),
            ]);
            setDepartments(dRes.data);
            setBranches(bRes.data);
            setPermissions(pRes.data);
        } catch { toast.error("Failed to load data"); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchAll(); }, []);

    const openPool = async (d: Department) => {
        if (d.isAllAccess) return; // all-access pool is auto-managed, nothing to edit
        setPoolEditId(d.id);
        setAddingNew(false);
        setEditId(null);
        try {
            const res = await axios.get<{ permissionIds: string[] | null }>(`/api/departments/${d.id}/permissions`);
            const ids = new Set(res.data.permissionIds ?? []);
            setPoolSelected(ids);
            setPoolOriginal(new Set(ids));
        } catch {
            toast.error("Failed to load permission pool");
            setPoolEditId(null);
        }
    };

    const togglePoolPerm = (id: string) => {
        setPoolSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const poolDirty = poolSelected.size !== poolOriginal.size
        || [...poolSelected].some(id => !poolOriginal.has(id));

    const savePool = async () => {
        if (!poolEditId) return;
        setPoolSaving(true);
        try {
            const res = await axios.put<{ strippedGrants: number; affectedRoles: number; poolSize: number }>(
                `/api/departments/${poolEditId}/permissions`,
                { permissionIds: [...poolSelected] },
            );
            const { strippedGrants } = res.data;
            toast.success(
                strippedGrants > 0
                    ? `Pool saved · removed ${strippedGrants} grant${strippedGrants === 1 ? "" : "s"} from roles in this department`
                    : "Permission pool saved",
            );
            setPoolEditId(null);
            fetchAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save permission pool");
        } finally { setPoolSaving(false); }
    };

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
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
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
                                <>
                                <div className="flex items-center gap-4 px-4 py-3">
                                    <Badge className="font-mono text-xs shrink-0">{d.id}</Badge>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm">
                                            {d.name}
                                            {d.isAllAccess && (
                                                <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                                    <ShieldCheck size={10} /> All-access
                                                </span>
                                            )}
                                        </p>
                                        {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <Badge className="bg-muted text-muted-foreground text-xs">
                                            {d.branch
                                                ? d.branch.name
                                                : d._count.branches > 0
                                                    ? `Org-wide · used by ${d._count.branches} branch${d._count.branches !== 1 ? "es" : ""}`
                                                    : "Org-wide"
                                            }
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {d._count.roles} role{d._count.roles !== 1 ? "s" : ""} · {d._count.positions} position{d._count.positions !== 1 ? "s" : ""} · {d._count.users} user{d._count.users !== 1 ? "s" : ""}
                                        </span>
                                        <Button
                                            variant={poolEditId === d.id ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => (poolEditId === d.id ? setPoolEditId(null) : openPool(d))}
                                            disabled={d.isAllAccess}
                                            title={d.isAllAccess ? "All-access — pool is managed automatically" : "Edit permission pool"}
                                        >
                                            <KeyRound size={14} /> {d.isAllAccess ? "All permissions" : `Permissions (${d._count.permissionPool})`}
                                        </Button>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="icon-sm" onClick={() => startEdit(d)}><Pencil size={14} /></Button>
                                            <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(d.id)}><Trash2 size={14} /></Button>
                                        </div>
                                    </div>
                                </div>
                                {poolEditId === d.id && !d.isAllAccess && (
                                    <PoolEditor
                                        deptName={d.name}
                                        permissions={permissions}
                                        selected={poolSelected}
                                        saving={poolSaving}
                                        dirty={poolDirty}
                                        onToggle={togglePoolPerm}
                                        onSave={savePool}
                                        onCancel={() => setPoolEditId(null)}
                                    />
                                )}
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
            </div>
        </ScrollArea>
    );
}

function PoolEditor({
    deptName,
    permissions,
    selected,
    saving,
    dirty,
    onToggle,
    onSave,
    onCancel,
}: {
    deptName: string;
    permissions: Permission[];
    selected: Set<string>;
    saving: boolean;
    dirty: boolean;
    onToggle: (id: string) => void;
    onSave: () => void;
    onCancel: () => void;
}) {
    const [search, setSearch] = useState("");
    const filtered = search.trim()
        ? permissions.filter(p =>
            [p.label, p.id, p.module, p.description ?? ""].some(v => v.toLowerCase().includes(search.toLowerCase())))
        : permissions;
    // admin:bypass is a system-only sentinel — never offered in a department pool.
    const poolable = filtered.filter(p => p.id !== "admin:bypass");
    const modules = [...new Set(poolable.map(p => p.module))].sort();

    return (
        <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold">
                    Permission pool for <span className="text-primary">{deptName}</span>
                    <span className="ml-2 font-normal text-muted-foreground">
                        {selected.size} selected · roles in this department may only hold these
                    </span>
                </p>
                <div className="flex gap-2">
                    <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
                        <Save size={14} /> {saving ? "Saving…" : "Save pool"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={onCancel}><X size={14} /> Close</Button>
                </div>
            </div>
            <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search permissions by name, module, or ID…"
                className="h-7 max-w-xs text-xs"
            />
            <div className="max-h-[50vh] space-y-3 overflow-auto pr-1">
                {modules.map(module => (
                    <div key={module}>
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{module}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {poolable.filter(p => p.module === module).map(p => {
                                const on = selected.has(p.id);
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => onToggle(p.id)}
                                        title={p.description ?? p.id}
                                        className={[
                                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                                            on
                                                ? "border-primary bg-primary/10 text-foreground"
                                                : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                        ].join(" ")}
                                    >
                                        {on && <Check size={11} />}{p.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
