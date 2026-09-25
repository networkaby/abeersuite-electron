"use client";

// Admin → Users — every staff login, and the one place for a person's extra
// permissions (the shield button). Add / Edit / Delete are the same dialog,
// helper and API as HR → Staff Directory, so either page may do them; each
// write announces `settings`, which is what refreshes the other page.

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { Plus, Pencil, Trash2, ShieldCheck, X, Loader2, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import UserForm from "@/shared/components/UserForm";
import UserAvatar from "@/shared/components/UserAvatar";
import { PositionChip } from "@/shared/components/PositionChip";
import Link from "next/link";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAndDeleteUser } from "@/shared/lib/users/deleteUserLogin";
import { applyPermissionOverrides } from "@/shared/lib/auth/crudLadder";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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

interface Position {
    id:           string;
    title:        string;
    branch:       { id: string; name: string } | null;
    department:   { id: string; name: string } | null;
    roleTemplates: { id: string; label: string; color: string }[];
}

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    title: string | null;
    scope: string;
    createdAt: string;
    managerId: number | null;
    avatarUrl: string | null;
    positions: Position[];
}

type Override = "GRANT" | "DENY";

interface PermRow {
    id: string;
    label: string;
    module: string;
    description: string | null;
    /** Given by their role or any seat's role (CRUD ladder applied). */
    roleGranted: boolean;
    userOverride: Override | null;
    /** What their session actually holds today. */
    effective: boolean;
}

interface PermissionsResponse {
    bypass: boolean;
    permissions: PermRow[];
}

/**
 * One person's extra permissions. A row's tick is what they may do; a click
 * flips it with the smallest override that does so — a Deny when the role
 * gives it, a Grant when it does not, and clearing an override that is no
 * longer needed. Everything changed saves in one PUT, and the person is signed
 * out so the change reaches them on their next click.
 */
function PermissionsModal({ user, onClose }: { user: User; onClose: () => void }) {
    const [data, setData] = useState<PermissionsResponse | null>(null);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState("");
    const [onlyOverrides, setOnlyOverrides] = useState(false);
    // Changed rows only: permission id → the override it should end with.
    const [changes, setChanges] = useState<Map<string, Override | null>>(new Map());

    useEffect(() => {
        axios.get<PermissionsResponse>(`/api/users/${user.id}/permissions`)
            .then(r => setData(r.data))
            .catch((e) => { toast.error(extractApiError(e, "Failed to load permissions")); onClose(); });
    }, [user.id, onClose]);

    const overrideOf = (p: PermRow): Override | null =>
        changes.has(p.id) ? changes.get(p.id)! : p.userOverride;

    // The preview runs the rule sign-in runs, so it shows knock-on effects too:
    // a Deny on "create" also takes "edit" and "delete" away. Unchanged, the
    // server's own answer is shown as-is.
    const previewGrants = useMemo(() => {
        if (!data || changes.size === 0) return null;
        const grants = new Set(data.permissions.filter(p => p.roleGranted).map(p => p.id));
        const overrides = data.permissions.flatMap(p => {
            const type = changes.has(p.id) ? changes.get(p.id)! : p.userOverride;
            return type ? [{ permissionId: p.id, type }] : [];
        });
        return [...applyPermissionOverrides(grants, overrides)];
    }, [data, changes]);

    const effectiveOf = (p: PermRow): boolean => {
        if (data?.bypass) return true;
        return previewGrants ? hasPermissionWithScope(previewGrants, p.id, false) : p.effective;
    };

    const toggle = (p: PermRow) => {
        const current = overrideOf(p);
        const next: Override | null = effectiveOf(p)
            ? (!p.roleGranted && current === "GRANT" ? null : "DENY")
            : (p.roleGranted && current === "DENY" ? null : "GRANT");
        setChanges(prev => {
            const m = new Map(prev);
            if (next === p.userOverride) m.delete(p.id);
            else m.set(p.id, next);
            return m;
        });
    };

    const save = async () => {
        if (changes.size === 0) { onClose(); return; }
        setSaving(true);
        try {
            const overrides = [...changes].map(([permissionId, type]) => ({ permissionId, type }));
            await axios.put(`/api/users/${user.id}/permissions`, { overrides });
            toast.success(`Saved — ${user.name} is signed out so the change takes effect`);
            onClose();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save permissions"));
        } finally {
            setSaving(false);
        }
    };

    const grouped = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const out: Record<string, PermRow[]> = {};
        for (const p of data?.permissions ?? []) {
            if (onlyOverrides && !p.userOverride && !changes.has(p.id)) continue;
            if (needle && ![p.label, p.id, p.module, p.description ?? ""].join(" ").toLowerCase().includes(needle)) continue;
            (out[p.module] ??= []).push(p);
        }
        return out;
    }, [data, query, onlyOverrides, changes]);

    const overrideCount = (data?.permissions ?? []).filter(p => overrideOf(p) !== null).length;

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Permissions — {user.name}</DialogTitle>
                    <DialogDescription>
                        Ticked = they may do it. &quot;From role&quot; comes from their role or seat; a click adds a
                        Grant or a Deny for this person only.
                    </DialogDescription>
                </DialogHeader>

                {data?.bypass && (
                    <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                        This login bypasses every permission check — overrides change nothing for it.
                    </p>
                )}

                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search permissions"
                            aria-label="Search permissions"
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant={onlyOverrides ? "default" : "outline"}
                        aria-pressed={onlyOverrides}
                        onClick={() => setOnlyOverrides(o => !o)}
                        className="h-8 shrink-0 text-xs"
                    >
                        Overrides{overrideCount > 0 ? ` (${overrideCount})` : ""}
                    </Button>
                </div>

                <div className="overflow-y-auto flex-1 space-y-5 pr-1">
                    {!data ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-muted-foreground" />
                        </div>
                    ) : Object.keys(grouped).length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            {onlyOverrides ? "No overrides for this person." : "Nothing matches."}
                        </p>
                    ) : (
                        Object.entries(grouped).map(([module, rows]) => (
                            <div key={module}>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{module}</p>
                                <div className="space-y-1">
                                    {rows.map(p => {
                                        const override = overrideOf(p);
                                        const effective = effectiveOf(p);
                                        return (
                                            <button
                                                key={p.id}
                                                type="button"
                                                disabled={data.bypass}
                                                aria-pressed={effective}
                                                className={cn(
                                                    "flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-default",
                                                    effective ? "opacity-100" : "opacity-60",
                                                    changes.has(p.id) && "border-primary/50 bg-primary/5",
                                                )}
                                                onClick={() => toggle(p)}
                                            >
                                                <span className={cn(
                                                    "flex h-4 w-4 shrink-0 items-center justify-center border",
                                                    effective ? "bg-primary border-primary" : "border-border",
                                                )}>
                                                    {effective && <span className="w-2 h-2 bg-primary-foreground" />}
                                                </span>
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm font-medium text-foreground">{p.label}</span>
                                                    {p.description && <span className="block text-xs text-muted-foreground truncate">{p.description}</span>}
                                                </span>
                                                <span className="shrink-0 flex gap-1">
                                                    {p.roleGranted && <Badge className="bg-primary/10 text-primary border-primary/20">From role</Badge>}
                                                    {override && (
                                                        <Badge className={override === "GRANT" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}>
                                                            {override === "GRANT" ? "+Grant" : "Deny"}
                                                        </Badge>
                                                    )}
                                                </span>
                                            </button>
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
                    <Button type="button" onClick={save} disabled={saving || changes.size === 0}>
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {changes.size === 0 ? "No changes" : `Save ${changes.size} change${changes.size !== 1 ? "s" : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function UsersPage() {
    const { data: session } = useSession();
    const myUserId = Number((session?.user as { id?: string } | undefined)?.id) || null;
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

    // A user added, edited or deleted here, in HR → Staff Directory or on
    // another machine announces `settings`. The list is separate state from the
    // open UserForm, so a refresh mid-edit does not disturb what is being typed.
    useRealtimeTopics(["settings"], () => { fetchUsers(); });

    const handleDelete = async (u: User) => {
        if (await confirmAndDeleteUser(u)) fetchUsers();
    };

    // Stable, so the open modal does not re-read its list on every list refresh.
    const closePermissions = useCallback(() => setPermUser(null), []);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Users</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The same people as HR → Staff Directory — add, edit or delete on either page.
                        The shield gives one person an extra permission, or takes one away.
                    </p>
                </div>
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

            {permUser && <PermissionsModal user={permUser} onClose={closePermissions} />}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border shadow">
                    <Table className="min-w-max">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Positions</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((u) => (
                                <TableRow key={u.id}>
                                    <TableCell className="text-muted-foreground">{u.id}</TableCell>
                                    <TableCell>
                                        <Link href={`/office/social/users/${u.id}`} className="flex items-center gap-2.5 group">
                                            <UserAvatar avatarUrl={u.avatarUrl} name={u.name} role={u.role} sizePx={32} className="shrink-0" />
                                            <div>
                                                <div className="font-medium group-hover:text-primary transition-colors">{u.name}</div>
                                                {u.title && <div className="text-xs text-muted-foreground">{u.title}</div>}
                                            </div>
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                                    <TableCell>
                                        {u.positions.length > 0 ? (
                                            <div className="flex flex-wrap gap-1.5 max-w-md">
                                                {u.positions.map((p) => (
                                                    <PositionChip key={p.id} position={p} />
                                                ))}
                                            </div>
                                        ) : (
                                            <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-xs gap-1">
                                                <AlertTriangle size={11} />
                                                No position assigned
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                                    <TableCell>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => setPermUser(u)}
                                                title="Extra permissions"
                                                aria-label={`Extra permissions for ${u.name}`}
                                            >
                                                <ShieldCheck size={14} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => setEditUser(u)}
                                                title="Edit login"
                                                aria-label={`Edit ${u.name}'s login`}
                                            >
                                                <Pencil size={14} />
                                            </Button>
                                            {u.id !== myUserId && (
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    size="icon-sm"
                                                    onClick={() => handleDelete(u)}
                                                    title="Delete login"
                                                    aria-label={`Delete ${u.name}'s login`}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            </div>
        </ScrollArea>
    );
}
