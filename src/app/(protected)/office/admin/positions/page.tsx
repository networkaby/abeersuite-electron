"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { invalidatePositionPicker } from "@/shared/hooks";
import Image from "next/image";
import {
    Plus, Pencil, Trash2, X, Check, Briefcase,
    UserPlus, ChevronDown, ChevronRight, Building2, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { initials } from "@/shared/lib/format/initials";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Branch     { id: string; name: string; }
interface Department { id: string; name: string; branchId: string | null; }
interface UserStub   { id: number; name: string; avatarUrl: string | null; role: string; title: string | null; userRole: { label: string; color: string } | null; }
interface RoleOption { id: string; label: string; color: string; department: { id: string; name: string } | null; }

interface Position {
    id: string;
    title: string;
    branchId: string | null;
    departmentId: string | null;
    parentPositionId: string | null;
    branch:     { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    parent:     { id: string; title: string } | null;
    roleTemplates: { id: string; label: string; color: string }[];
    holders:    { user: UserStub }[];
    _count:     { children: number };
}

type FormState = { id: string; title: string; branchId: string; parentPositionId: string; roleTemplateIds: string[] };
const EMPTY: FormState = { id: "", title: "", branchId: "", parentPositionId: "", roleTemplateIds: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700", R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",   R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

function UserChip({ user, onRemove }: { user: UserStub; onRemove?: () => void }) {
    const [imgErr, setImgErr] = useState(false);
    return (
        <span className="flex items-center gap-1.5 border border-border bg-muted/50 px-2 py-1 text-xs">
            {user.avatarUrl && !imgErr ? (
                <Image src={user.avatarUrl} alt={user.name} width={16} height={16} className="rounded-full object-cover" onError={() => setImgErr(true)} />
            ) : (
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${AVATAR_COLOR[user.role] ?? "bg-gray-100 text-gray-600"}`}>
                    {initials(user.name)}
                </span>
            )}
            <span className="font-medium">{user.name}</span>
            {user.userRole && (
                <Badge className={`${user.userRole.color} text-[10px] px-1 py-0`}>{user.userRole.label}</Badge>
            )}
            {onRemove && (
                <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} className="ml-0.5" title="Remove">
                    <X size={11} />
                </Button>
            )}
        </span>
    );
}

function roleDepartmentHint(roleIds: string[], roleOptions: RoleOption[]): string | null {
    const depts = [...new Set(
        roleIds
            .map((id) => roleOptions.find((r) => r.id === id)?.department?.name)
            .filter((name): name is string => Boolean(name)),
    )];
    if (depts.length === 0) return null;
    if (depts.length === 1) return depts[0]!;
    return depts.join(", ");
}

function RoleTemplatePicker({
    roleOptions,
    selectedIds,
    onChange,
}: {
    roleOptions: RoleOption[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
}) {
    const toggle = (roleId: string, checked: boolean) => {
        onChange(
            checked
                ? [...selectedIds, roleId]
                : selectedIds.filter((id) => id !== roleId),
        );
    };

    const deptHint = roleDepartmentHint(selectedIds, roleOptions);

    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground">Role templates</label>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2">
                {roleOptions.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground italic">No roles available</p>
                ) : (
                    roleOptions.map((role) => {
                        const checked = selectedIds.includes(role.id);
                        return (
                            <label
                                key={role.id}
                                className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50"
                            >
                                <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) => toggle(role.id, value === true)}
                                    className="mt-0.5"
                                />
                                <span className="text-sm leading-snug">
                                    <span className="font-medium">{role.label}</span>
                                    <span className="text-muted-foreground"> ({role.id})</span>
                                    {role.department && (
                                        <span className="text-muted-foreground"> · {role.department.name}</span>
                                    )}
                                </span>
                            </label>
                        );
                    })
                )}
            </div>
            {deptHint && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                    Home department{deptHint.includes(",") ? "s" : ""}:{" "}
                    <span className="font-medium text-foreground">{deptHint}</span> (from roles)
                </p>
            )}
        </div>
    );
}

// ── Form fields (extracted to avoid remount on parent re-render) ──────────────

function PositionFormFields({
    addingNew, form, branches, allPositions, roleOptions, onChange,
}: {
    addingNew: boolean;
    form: FormState;
    branches: Branch[];
    allPositions: Position[];
    roleOptions: RoleOption[];
    onChange: (f: FormState) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {addingNew && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground">ID (e.g. POS-CEO) *</label>
                    <Input
                        value={form.id}
                        onChange={e => onChange({ ...form, id: e.target.value.toUpperCase() })}
                        placeholder="POS-BM-DEL"
                        className="mt-1 font-mono uppercase"
                    />
                </div>
            )}
            <div className={addingNew ? "" : "col-span-2"}>
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <Input
                    value={form.title}
                    onChange={e => onChange({ ...form, title: e.target.value })}
                    placeholder="Branch Manager"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Branch scope <span className="font-normal">(blank = org-wide)</span></label>
                <Select value={form.branchId || "org-wide"} onValueChange={(value) => onChange({ ...form, branchId: value === "org-wide" ? "" : value })}>
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Org-wide (Executive Council)" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="org-wide">Org-wide (Executive Council)</SelectItem>
                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="col-span-2">
                <RoleTemplatePicker
                    roleOptions={roleOptions}
                    selectedIds={form.roleTemplateIds}
                    onChange={(roleTemplateIds) => onChange({ ...form, roleTemplateIds })}
                />
            </div>
            <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Reports to (parent position) <span className="font-normal">(optional)</span></label>
                <Select value={form.parentPositionId || "top-level"} onValueChange={(value) => onChange({ ...form, parentPositionId: value === "top-level" ? "" : value })}>
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Top level" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="top-level">Top level</SelectItem>
                        {allPositions.filter((p) => p.id !== form.id).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                {p.title}{p.branch ? ` · ${p.branch.name}` : ""}{p.department ? ` / ${p.department.name}` : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}

// ── Assign panel ──────────────────────────────────────────────────────────────

function AssignPanel({
    position, allUsers, onAssign, onUnassign,
}: {
    position: Position;
    allUsers: UserStub[];
    onAssign: (userId: number) => Promise<void>;
    onUnassign: (userId: number) => Promise<void>;
}) {
    const [search, setSearch] = useState("");
    const holderIds = new Set(position.holders.map(h => h.user.id));
    const candidates = allUsers.filter(
        u => !holderIds.has(u.id) && u.name.toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <div className="border-t border-border mt-3 pt-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Holders</p>
            {position.holders.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Vacant — no one appointed</p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {position.holders.map(h => (
                        <UserChip key={h.user.id} user={h.user} onRemove={() => onUnassign(h.user.id)} />
                    ))}
                </div>
            )}
            <div>
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search users to appoint…"
                    className="text-xs h-8"
                />
                {search && (
                    <div className="max-h-40 overflow-y-auto rounded-b-md border border-border border-t-0">
                        {candidates.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching users</p>
                        ) : (
                            candidates.map(u => (
                                <Button
                                    key={u.id}
                                    type="button"
                                    onClick={() => { onAssign(u.id); setSearch(""); }}
                                    variant="ghost"
                                    className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left text-xs"
                                >
                                    <span className="font-medium">{u.name}</span>
                                    {u.userRole && (
                                        <Badge className={`${u.userRole.color} text-[10px] px-1 py-0`}>{u.userRole.label}</Badge>
                                    )}
                                    {u.title && <span className="text-muted-foreground">{u.title}</span>}
                                </Button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Position row ──────────────────────────────────────────────────────────────

function PositionRow({
    position, allPositions, allUsers, branches, roleOptions,
    onSave, onDelete, onAssign, onUnassign,
}: {
    position: Position;
    allPositions: Position[];
    allUsers: UserStub[];
    branches: Branch[];
    roleOptions: RoleOption[];
    onSave: (id: string, data: object) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onAssign: (positionId: string, userId: number) => Promise<void>;
    onUnassign: (positionId: string, userId: number) => Promise<void>;
}) {
    const [editing, setEditing]   = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [form, setForm]         = useState<FormState>({
        id: position.id, title: position.title,
        branchId: position.branchId ?? "", parentPositionId: position.parentPositionId ?? "",
        roleTemplateIds: position.roleTemplates.map((r) => r.id),
    });
    const [saving, setSaving] = useState(false);

    const scopeLabel = position.branch
        ? (position.department ? `${position.branch.name} / ${position.department.name}` : position.branch.name)
        : "Executive Council";

    // Always sync form with latest position data when opening edit mode
    const openEdit = () => {
        setForm({
            id: position.id, title: position.title,
            branchId: position.branchId ?? "", parentPositionId: position.parentPositionId ?? "",
            roleTemplateIds: position.roleTemplates.map((r) => r.id),
        });
        setEditing(true);
    };

    const handleSave = async () => {
        if (!form.title.trim()) { return; }
        setSaving(true);
        try {
            await onSave(position.id, {
                title:            form.title,
                branchId:         form.branchId         || null,
                parentPositionId: form.parentPositionId || null,
                roleTemplateIds:  form.roleTemplateIds,
            });
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-card">
            {editing ? (
                <div className="p-4 space-y-3">
                    <PositionFormFields
                        addingNew={false} form={form} branches={branches}
                        allPositions={allPositions} roleOptions={roleOptions} onChange={setForm}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} disabled={saving}><Check size={14} /> Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            ) : (
                <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setExpanded(o => !o)}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </Button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm">{position.title}</p>
                                <Badge className="font-mono text-[10px]">{position.id}</Badge>
                                {position.parent && (
                                    <span className="text-[11px] text-muted-foreground">↑ {position.parent.title}</span>
                                )}
                                {position.roleTemplates.map((role) => (
                                    <Badge key={role.id} className={`${role.color} text-[10px]`}>
                                        {role.label}
                                    </Badge>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                {position.branchId ? (
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                        <Building2 size={10} /> {scopeLabel}
                                    </span>
                                ) : (
                                    <span className="text-[11px] text-orange-600 flex items-center gap-1 font-medium">
                                        <Briefcase size={10} /> Executive Council
                                    </span>
                                )}
                                {position._count.children > 0 && (
                                    <span className="text-[11px] text-muted-foreground">{position._count.children} sub-position{position._count.children !== 1 ? "s" : ""}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {position.holders.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground italic">Vacant</span>
                            ) : (
                                <div className="flex flex-wrap gap-1">
                                    {position.holders.map(h => <UserChip key={h.user.id} user={h.user} />)}
                                </div>
                            )}
                            <div className="flex gap-1 ml-2">
                                <Button variant="outline" size="icon-sm" title="Appoint / remove holders" onClick={() => setExpanded(o => !o)}>
                                    <UserPlus size={13} />
                                </Button>
                                <Button variant="outline" size="icon-sm" onClick={openEdit}><Pencil size={14} /></Button>
                                <Button variant="destructive" size="icon-sm" onClick={() => onDelete(position.id)}><Trash2 size={14} /></Button>
                            </div>
                        </div>
                    </div>
                    {expanded && (
                        <AssignPanel
                            position={position} allUsers={allUsers}
                            onAssign={uid => onAssign(position.id, uid)}
                            onUnassign={uid => onUnassign(position.id, uid)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PositionsPage() {
    const [positions, setPositions]   = useState<Position[]>([]);
    const [branches, setBranches]     = useState<Branch[]>([]);
    const [departments, setDepts]     = useState<Department[]>([]);
    const [allUsers, setAllUsers]     = useState<UserStub[]>([]);
    const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
    const [loading, setLoading]       = useState(true);
    const [addingNew, setAddingNew]   = useState(false);
    const [form, setForm]             = useState<FormState>(EMPTY);
    const [saving, setSaving]         = useState(false);
    const [filterBranch, setFilter]   = useState("");

    const { data: session } = useSession();
    const myUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

    const loadAll = async () => {
        try {
            const [pRes, bRes, dRes, uRes, rRes] = await Promise.all([
                axios.get<Position[]>("/api/positions"),
                axios.get<Branch[]>("/api/branches"),
                axios.get<Department[]>("/api/departments"),
                axios.get<UserStub[]>("/api/users"),
                axios.get<RoleOption[]>("/api/roles"),
            ]);
            setPositions(pRes.data);
            setBranches(bRes.data);
            setDepts(dRes.data);
            setAllUsers(uRes.data);
            setRoleOptions(rRes.data);
        } catch { toast.error("Failed to load data"); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadAll(); }, []);

    /**
     * Reload this screen AND drop the cached picker list, so the six filter
     * dropdowns that read it (Contacts, Reconnect, Deals, Help, Administration,
     * Recurring) show the change straight away rather than at the cache's TTL.
     * Only this browser is reachable from here — see usePositionPicker's note.
     */
    const afterMutation = () => {
        if (myUserId) invalidatePositionPicker(myUserId);
        loadAll();
    };

    const handleCreate = async () => {
        if (!form.id.trim()) { toast.error("ID is required"); return; }
        if (!form.title.trim()) { toast.error("Title is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/positions", {
                id:               form.id.toUpperCase(),
                title:            form.title,
                branchId:         form.branchId         || null,
                parentPositionId: form.parentPositionId || null,
                roleTemplateIds:  form.roleTemplateIds,
            });
            toast.success("Position created");
            setForm(EMPTY); setAddingNew(false);
            afterMutation();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to create position");
        } finally { setSaving(false); }
    };

    const handleSave = async (id: string, data: object) => {
        try {
            await axios.patch(`/api/positions/${id}`, data);
            toast.success("Position updated");
            afterMutation();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to update position");
            throw e; // re-throw so PositionRow keeps edit panel open
        }
    };

    const handleDelete = async (id: string) => {
        if (!(await confirmAction({ title: "Delete this position?", confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/positions/${id}`);
            toast.success("Position deleted");
            afterMutation();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete position");
        }
    };

    const handleAssign = async (positionId: string, userId: number) => {
        try {
            await axios.post(`/api/positions/${positionId}/holders`, { userId });
            toast.success("User appointed");
            afterMutation();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to appoint user");
        }
    };

    const handleUnassign = async (positionId: string, userId: number) => {
        try {
            await axios.delete(`/api/positions/${positionId}/holders/${userId}`);
            toast.success("User removed from position");
            afterMutation();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to remove user");
        }
    };

    const filteredPositions = filterBranch
        ? positions.filter(p => p.branchId === filterBranch || (!p.branchId && filterBranch === "__org"))
        : positions;

    const orgPositions    = filteredPositions.filter(p => !p.branchId);
    const branchPositions = branches.map(b => ({
        branch: b,
        positions:  filteredPositions.filter(p => p.branchId === b.id),
    })).filter(g => g.positions.length > 0);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Briefcase size={28} /> Positions
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Define positions in your organisation. Appoint one or more people to each position.
                    </p>
                </div>
                <Button onClick={() => { setForm(EMPTY); setAddingNew(true); }} disabled={addingNew}>
                    <Plus size={16} /> New Position
                </Button>
            </div>

            {/* Filter */}
            <div className="flex gap-2 flex-wrap">
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setFilter("")}
                    className={!filterBranch ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                >
                    All
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setFilter("__org")}
                    className={filterBranch === "__org" ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                >
                    Executive Council
                </Button>
                {branches.map(b => (
                    <Button
                        key={b.id}
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setFilter(b.id)}
                        className={filterBranch === b.id ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                    >
                        {b.name}
                    </Button>
                ))}
            </div>

            {/* New position form */}
            {addingNew && (
                <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                    <p className="text-sm font-semibold">New Position</p>
                    <PositionFormFields
                        addingNew={true} form={form} branches={branches}
                        allPositions={positions} roleOptions={roleOptions} onChange={setForm}
                    />
                    <div className="flex gap-2 pt-1">
                        <Button onClick={handleCreate} disabled={saving} size="sm"><Check size={14} /> Create</Button>
                        <Button variant="outline" size="sm" onClick={() => setAddingNew(false)}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : positions.length === 0 && !addingNew ? (
                <p className="border-dashed text-sm text-muted-foreground py-12 text-center border border-border">
                    No positions yet. Create your first one above.
                </p>
            ) : (
                <div className="space-y-6">
                    {/* Executive Council (org-wide) */}
                    {orgPositions.length > 0 && (
                        <section>
                            <div className="flex items-center gap-2 mb-2">
                                <Briefcase size={14} className="text-orange-600" />
                                <h2 className="text-xs font-bold uppercase tracking-widest text-orange-600">Executive Council</h2>
                                <span className="text-[11px] text-muted-foreground">({orgPositions.length})</span>
                            </div>
                            <div className="space-y-1.5">
                                {orgPositions.map(p => (
                                    <PositionRow key={p.id} position={p} allPositions={positions} allUsers={allUsers}
                                        branches={branches} roleOptions={roleOptions}
                                        onSave={handleSave} onDelete={handleDelete}
                                        onAssign={handleAssign} onUnassign={handleUnassign} />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Per-branch groups */}
                    {branchPositions.map(({ branch, positions: bPositions }) => {
                        const deptGroups = departments
                            .filter(d => d.branchId === branch.id || d.branchId === null)
                            .map(d => ({ dept: d, positions: bPositions.filter(p => p.departmentId === d.id) }))
                            .filter(g => g.positions.length > 0);
                        const noDeptPositions = bPositions.filter(p => !p.departmentId);

                        return (
                            <section key={branch.id}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Building2 size={14} className="text-primary" />
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary">{branch.name}</h2>
                                    <span className="text-[11px] text-muted-foreground">({bPositions.length})</span>
                                </div>

                                {/* Branch-level positions (no dept) */}
                                {noDeptPositions.length > 0 && (
                                    <div className="space-y-1.5 mb-3">
                                        {noDeptPositions.map(p => (
                                            <PositionRow key={p.id} position={p} allPositions={positions} allUsers={allUsers}
                                                branches={branches} roleOptions={roleOptions}
                                                onSave={handleSave} onDelete={handleDelete}
                                                onAssign={handleAssign} onUnassign={handleUnassign} />
                                        ))}
                                    </div>
                                )}

                                {/* Dept sub-groups */}
                                {deptGroups.map(({ dept, positions: dPositions }) => (
                                    <div key={dept.id} className="ml-4 border-l-2 border-border pl-4 mb-3">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <Layers size={12} className="text-muted-foreground" />
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{dept.name}</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {dPositions.map(p => (
                                                <PositionRow key={p.id} position={p} allPositions={positions} allUsers={allUsers}
                                                    branches={branches} roleOptions={roleOptions}
                                                    onSave={handleSave} onDelete={handleDelete}
                                                    onAssign={handleAssign} onUnassign={handleUnassign} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        );
                    })}
                </div>
            )}
            </div>
        </ScrollArea>
    );
}
