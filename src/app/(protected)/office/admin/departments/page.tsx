"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Layers, Save, ShieldCheck, Search } from "lucide-react";
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
import { GL_VOUCHER_MATRIX, voucherKindPermissionIds } from "@/shared/lib/auth/voucherMatrix";

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

    // Master/detail selection — which department's pool is shown on the right.
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [poolSelected, setPoolSelected] = useState<Set<string>>(new Set());
    const [poolOriginal, setPoolOriginal] = useState<Set<string>>(new Set());
    const [poolSaving, setPoolSaving] = useState(false);

    const selected = departments.find(d => d.id === selectedId) ?? null;

    const poolDirty = poolSelected.size !== poolOriginal.size
        || [...poolSelected].some(id => !poolOriginal.has(id));

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
            // Keep the current selection, else select the first department.
            setSelectedId(prev => prev && dRes.data.some(d => d.id === prev) ? prev : dRes.data[0]?.id ?? null);
        } catch { toast.error("Failed to load data"); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchAll(); }, []);

    // Load the selected department's pool whenever the selection changes.
    useEffect(() => {
        if (!selectedId) return;
        const dept = departments.find(d => d.id === selectedId);
        if (!dept || dept.isAllAccess) { setPoolSelected(new Set()); setPoolOriginal(new Set()); return; }
        let cancelled = false;
        axios.get<{ permissionIds: string[] | null }>(`/api/departments/${selectedId}/permissions`)
            .then(res => {
                if (cancelled) return;
                const ids = new Set(res.data.permissionIds ?? []);
                setPoolSelected(ids);
                setPoolOriginal(new Set(ids));
            })
            .catch(() => { if (!cancelled) toast.error("Failed to load permission pool"); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    const selectDept = (id: string) => {
        if (poolDirty && !confirm("Discard unsaved permission changes?")) return;
        setAddingNew(false);
        setEditId(null);
        setSelectedId(id);
    };

    const togglePoolPerm = (id: string) => {
        setPoolSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Bulk on/off for a set of ids (a voucher-kind toggle flips all of its actions).
    const setPoolPerms = (ids: string[], on: boolean) => {
        setPoolSelected(prev => {
            const next = new Set(prev);
            for (const id of ids) { if (on) next.add(id); else next.delete(id); }
            return next;
        });
    };

    const savePool = async () => {
        if (!selectedId) return;
        setPoolSaving(true);
        try {
            const res = await axios.put<{ strippedGrants: number; affectedRoles: number; poolSize: number }>(
                `/api/departments/${selectedId}/permissions`,
                { permissionIds: [...poolSelected] },
            );
            const { strippedGrants } = res.data;
            toast.success(
                strippedGrants > 0
                    ? `Pool saved · removed ${strippedGrants} grant${strippedGrants === 1 ? "" : "s"} from roles in this department`
                    : "Permission pool saved",
            );
            setPoolOriginal(new Set(poolSelected));
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
                const res = await axios.post<Department>("/api/departments", { ...payload, id: form.id.toUpperCase() });
                toast.success("Department created");
                setSelectedId(res.data.id);
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
            if (selectedId === id) setSelectedId(null);
            fetchAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete department");
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Layers size={24} /> Departments
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Functional groupings — pick the permission names each department may use. Access levels are set per-role.</p>
                </div>
                <Button onClick={startAdd} disabled={addingNew}>
                    <Plus size={16} /> New Department
                </Button>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                    {/* LEFT — department names */}
                    <aside className="space-y-1 xl:sticky xl:top-3 xl:self-start">
                        {departments.length === 0 && !addingNew && (
                            <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border rounded-lg">No departments yet. Create one above.</p>
                        )}
                        {departments.map(d => {
                            const isActive = d.id === selectedId && !addingNew && !editId;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => selectDept(d.id)}
                                    className={[
                                        "w-full rounded-lg border border-l-4 px-3 py-2 text-left transition-colors",
                                        isActive
                                            ? "border-primary border-l-primary bg-primary/5"
                                            : "border-border border-l-primary/40 bg-card hover:bg-muted/40",
                                    ].join(" ")}
                                >
                                    <div className="flex items-center gap-2">
                                        <Badge className="font-mono text-[10px] shrink-0">{d.id}</Badge>
                                        <span className="font-semibold text-sm truncate">{d.name}</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        {d.isAllAccess
                                            ? "All permissions"
                                            : `${d._count.permissionPool} permission${d._count.permissionPool !== 1 ? "s" : ""}`}
                                        {" · "}{d._count.roles} role{d._count.roles !== 1 ? "s" : ""}
                                    </p>
                                </button>
                            );
                        })}
                    </aside>

                    {/* RIGHT — form, or the selected department's permission pool */}
                    <section className="min-w-0">
                        {addingNew ? (
                            <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                                <p className="text-sm font-semibold">New Department</p>
                                <DeptFormFields addingNew={true} form={form} branches={branches} onChange={setForm} />
                                <div className="flex gap-2 pt-1">
                                    <Button onClick={handleSave} disabled={saving} size="sm"><Check size={14} /> Save</Button>
                                    <Button variant="outline" size="sm" onClick={cancel}><X size={14} /> Cancel</Button>
                                </div>
                            </div>
                        ) : editId && selected ? (
                            <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                                <p className="text-sm font-semibold">Edit {selected.name}</p>
                                <DeptFormFields addingNew={false} form={form} branches={branches} onChange={setForm} />
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={handleSave} disabled={saving}><Check size={14} /> Save</Button>
                                    <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                                </div>
                            </div>
                        ) : selected ? (
                            <div className="rounded-lg border border-border bg-card">
                                {/* header */}
                                <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-base flex items-center gap-2">
                                            {selected.name}
                                            {selected.isAllAccess && (
                                                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                                    <ShieldCheck size={10} /> All-access
                                                </span>
                                            )}
                                        </p>
                                        {selected.description && <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>}
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            <Badge className="bg-muted text-muted-foreground text-[10px] mr-2">
                                                {selected.branch
                                                    ? selected.branch.name
                                                    : selected._count.branches > 0
                                                        ? `Org-wide · ${selected._count.branches} branch${selected._count.branches !== 1 ? "es" : ""}`
                                                        : "Org-wide"}
                                            </Badge>
                                            {selected._count.roles} role{selected._count.roles !== 1 ? "s" : ""} · {selected._count.positions} position{selected._count.positions !== 1 ? "s" : ""} · {selected._count.users} user{selected._count.users !== 1 ? "s" : ""}
                                        </p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button variant="outline" size="icon-sm" onClick={() => startEdit(selected)} title="Edit department"><Pencil size={14} /></Button>
                                        <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(selected.id)} title="Delete department"><Trash2 size={14} /></Button>
                                    </div>
                                </div>

                                {selected.isAllAccess ? (
                                    <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                                        <ShieldCheck size={16} className="text-amber-600" />
                                        This is an all-access department — every permission is available automatically. Nothing to pick.
                                    </div>
                                ) : (
                                    <PoolEditor
                                        permissions={permissions}
                                        selected={poolSelected}
                                        saving={poolSaving}
                                        dirty={poolDirty}
                                        onToggle={togglePoolPerm}
                                        onToggleMany={setPoolPerms}
                                        onSave={savePool}
                                    />
                                )}
                            </div>
                        ) : (
                            <p className="border-dashed text-sm text-muted-foreground py-16 text-center border border-border rounded-lg">
                                Select a department on the left to manage its permissions.
                            </p>
                        )}
                    </section>
                </div>
            )}
            </div>
        </ScrollArea>
    );
}

function PoolEditor({
    permissions,
    selected,
    saving,
    dirty,
    onToggle,
    onToggleMany,
    onSave,
}: {
    permissions: Permission[];
    selected: Set<string>;
    saving: boolean;
    dirty: boolean;
    onToggle: (id: string) => void;
    onToggleMany: (ids: string[], on: boolean) => void;
    onSave: () => void;
}) {
    const [search, setSearch] = useState("");
    const q = search.trim().toLowerCase();
    const matches = (p: Permission) =>
        !q || [p.label, p.id, p.module, p.description ?? ""].some(v => v.toLowerCase().includes(q));
    const filtered = permissions.filter(matches);
    // admin:bypass is a system-only sentinel; GL voucher perms get their own
    // voucher-kind toggles below (the dept declares which voucher kinds it works
    // with — the create/post/cancel/delete access level is decided per-role).
    const poolable = filtered.filter(p => p.id !== "admin:bypass" && !p.id.startsWith("finance:voucher:"));
    const modules = [...new Set(poolable.map(p => p.module))].sort();
    const voucherKinds = GL_VOUCHER_MATRIX.filter(
        k => !q || k.label.toLowerCase().includes(q) || "voucher".includes(q),
    );

    return (
        <div className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{selected.size}</span> permissions in pool · roles in this department may only hold these.
                </p>
                <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
                    <Save size={14} /> {saving ? "Saving…" : "Save pool"}
                </Button>
            </div>
            <div className="relative max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search permissions…"
                    className="h-7 pl-8 text-xs"
                />
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
                {voucherKinds.length > 0 && (
                    <div>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            accountancy · vouchers <span className="font-normal normal-case">(which voucher kinds this dept works with)</span>
                        </p>
                        <div className="space-y-1">
                            {voucherKinds.map(kind => {
                                const ids = voucherKindPermissionIds(kind.type);
                                const on = ids.every(id => selected.has(id));
                                return (
                                    <PermRow
                                        key={kind.type}
                                        label={kind.label}
                                        sub={kind.type}
                                        on={on}
                                        onClick={() => onToggleMany(ids, !on)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
                {modules.map(module => (
                    <div key={module}>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{module}</p>
                        <div className="space-y-1">
                            {poolable.filter(p => p.module === module).map(p => (
                                <PermRow
                                    key={p.id}
                                    label={p.label}
                                    sub={p.id}
                                    title={p.description ?? p.id}
                                    on={selected.has(p.id)}
                                    onClick={() => onToggle(p.id)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
                {modules.length === 0 && voucherKinds.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">No permissions match your search.</p>
                )}
            </div>
        </div>
    );
}

function PermRow({
    label, sub, title, on, onClick,
}: {
    label: string;
    sub: string;
    title?: string;
    on: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={[
                "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                on
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:border-primary/50 hover:bg-muted/40",
            ].join(" ")}
        >
            <span
                className={[
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                ].join(" ")}
            >
                {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{sub}</span>
            </span>
        </button>
    );
}
