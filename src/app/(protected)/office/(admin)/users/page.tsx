"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Trash2, ShieldCheck, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import UserForm from "@/modules/shared/components/UserForm";
import UserAvatar from "@/modules/shared/components/UserAvatar";
import Link from "next/link";
import { formatDate } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

const SCOPE_LABELS: Record<string, string> = {
    OWN: "Own", TEAM: "Team", DEPARTMENT: "Dept",
    BRANCH: "Branch", REGION: "Region", ORG: "Org",
};

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    title: string | null;
    scope: string;
    createdAt: string;
    managerId: number | null;
    avatarUrl:   string | null;
    userRole:    { label: string; color: string; rank: number };
    departments: { id: string; name: string }[];
    branches:    { id: string; name: string }[];
}

interface PermRow {
    id: string;
    label: string;
    module: string;
    description: string | null;
    roleGranted: boolean;
    userOverride: boolean | null;
    effective: boolean;
}

function PermissionsModal({ user, onClose }: { user: User; onClose: () => void }) {
    const [perms, setPerms] = useState<PermRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [overrides, setOverrides] = useState<Map<string, boolean | null>>(new Map());

    useEffect(() => {
        axios.get(`/api/users/${user.id}/permissions`)
            .then(r => setPerms(r.data))
            .catch(() => toast.error("Failed to load permissions"))
            .finally(() => setLoading(false));
    }, [user.id]);

    const toggle = (permId: string, current: boolean | null, roleGranted: boolean) => {
        setOverrides(prev => {
            const next = new Map(prev);
            if (current === null) {
                next.set(permId, true);
            } else if (current === true && !roleGranted) {
                next.set(permId, false);
            } else if (current === false) {
                next.set(permId, null);
            } else {
                next.set(permId, false);
            }
            return next;
        });
    };

    const save = async () => {
        if (overrides.size === 0) { onClose(); return; }
        setSaving(true);
        try {
            const payload = Array.from(overrides.entries()).map(([permissionId, granted]) => ({ permissionId, granted }));
            await axios.put(`/api/users/${user.id}/permissions`, { overrides: payload });
            toast.success("Permissions saved");
            onClose();
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSaving(false);
        }
    };

    const grouped = perms.reduce<Record<string, PermRow[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Permissions — {user.name}</DialogTitle>
                    <DialogDescription>
                        Role grants are read-only. Overrides add or deny individual permissions.
                    </DialogDescription>
                </DialogHeader>

                <div className="overflow-y-auto flex-1 space-y-5 pr-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        Object.entries(grouped).map(([module, rows]) => (
                            <div key={module}>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{module}</p>
                                <div className="space-y-1">
                                    {rows.map(p => {
                                        const localOverride = overrides.get(p.id);
                                        const displayOverride = localOverride !== undefined ? localOverride : p.userOverride;
                                        const effective = displayOverride !== null ? !!displayOverride : p.roleGranted;

                                        return (
                                            <div
                                                key={p.id}
                                                className={`flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted ${
                                                    effective ? "opacity-100" : "opacity-50"
                                                }`}
                                                onClick={() => toggle(p.id, displayOverride, p.roleGranted)}
                                            >
                                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                                                    effective ? "bg-primary border-primary" : "border-border"
                                                }`}>
                                                    {effective && <div className="w-2 h-2 bg-primary-foreground" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-foreground">{p.label}</p>
                                                    {p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}
                                                </div>
                                                <div className="shrink-0 flex gap-1">
                                                    {p.roleGranted && <Badge className="bg-primary/10 text-primary border-primary/20">Role</Badge>}
                                                    {displayOverride !== null && (
                                                        <Badge className={displayOverride ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}>
                                                            {displayOverride ? "+Grant" : "Deny"}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <DialogFooter className="pt-2 border-t border-border">
                    <Button type="button" variant="outline" onClick={onClose}>
                        <X size={14} /> Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={saving || overrides.size === 0}>
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {overrides.size === 0 ? "No changes" : `Save ${overrides.size} change${overrides.size !== 1 ? "s" : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editUser, setEditUser] = useState<User | null>(null);
    const [permUser, setPermUser] = useState<User | null>(null);

    const fetchUsers = async () => {
        try {
            const res = await axios.get("/api/users");
            setUsers(res.data);
        } catch {
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleDelete = async (id: number) => {
        if (!confirm("Delete this user?")) return;
        try {
            await axios.delete(`/api/users/${id}`);
            toast.success("User deleted");
            fetchUsers();
        } catch {
            toast.error("Failed to delete user");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Users</h1>
                <Button type="button" onClick={() => setShowForm(true)}>
                    <Plus size={16} /> Add User
                </Button>
            </div>

            {(showForm || editUser) && (
                <UserForm
                    user={editUser ?? undefined}
                    onClose={() => { setShowForm(false); setEditUser(null); fetchUsers(); }}
                />
            )}

            {permUser && (
                <PermissionsModal user={permUser} onClose={() => { setPermUser(null); fetchUsers(); }} />
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Departments</TableHead>
                                <TableHead>Branches</TableHead>
                                <TableHead>Scope</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((u) => (
                                <TableRow key={u.id}>
                                    <TableCell className="text-muted-foreground">{u.id}</TableCell>
                                    <TableCell>
                                        <Link href={`/office/users/${u.id}`} className="flex items-center gap-2.5 group">
                                            <UserAvatar avatarUrl={u.avatarUrl} name={u.name} role={u.role} sizePx={32} className="shrink-0" />
                                            <div>
                                                <div className="font-medium group-hover:text-primary transition-colors">{u.name}</div>
                                                {u.title && <div className="text-xs text-muted-foreground">{u.title}</div>}
                                            </div>
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                                    <TableCell>
                                        <div><Badge className={u.userRole.color}>{u.userRole.label}</Badge></div>
                                        <div className="text-xs text-muted-foreground mt-0.5">rank {u.userRole.rank}</div>
                                    </TableCell>
                                    <TableCell>
                                        {u.departments.length > 0
                                            ? <div className="flex flex-wrap gap-1">{u.departments.map(d => <Badge key={d.id} className="bg-blue-50 text-blue-700 text-xs">{d.name}</Badge>)}</div>
                                            : <span className="text-muted-foreground text-sm">—</span>}
                                    </TableCell>
                                    <TableCell>
                                        {u.branches.length > 0
                                            ? <div className="flex flex-wrap gap-1">{u.branches.map(b => <Badge key={b.id} className="bg-orange-50 text-orange-700 text-xs">{b.name}</Badge>)}</div>
                                            : <span className="text-muted-foreground text-sm">—</span>}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className="bg-muted text-muted-foreground text-xs">{SCOPE_LABELS[u.scope] ?? u.scope}</Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                                    <TableCell>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => setPermUser(u)}
                                                title="Manage permissions"
                                            >
                                                <ShieldCheck size={14} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => setEditUser(u)}
                                            >
                                                <Pencil size={14} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="icon-sm"
                                                onClick={() => handleDelete(u.id)}
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
