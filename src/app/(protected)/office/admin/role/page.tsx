"use client";


import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Boxes, Plus, RotateCcw, Save, Search, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PermissionMatrix as SharedPermissionMatrix, type MatrixRow } from "@/shared/components/PermissionMatrix";
import { crudImpliedByGrant, crudDependentsOnRevoke, expandCrudGrants, normalizeCrudGrants } from "@/shared/lib/auth/crudLadder";
import {
    VOUCHER_COLUMN_GROUPS,
    VOUCHER_ROWS_BY_GROUP,
    POS_BLOCK_SHIFT_IDS,
    POOL_EXEMPT_PERMISSION_IDS,
    SIDEBAR_LINK_GRANULAR_IDS,
    EMPTY_ROLE,
    NO_COPY_ROLE,
    roleToForm,
    getErrorMessage,
    type Permission,
    type WorkRow,
    type WorkGroupRow,
    type Department,
    type Role,
    type RoleForm,
} from "@/modules/admin/lib/roleMatrixConfig";
import {
    RoleDetailsCard,
    NewRoleDialog,
    RoleList,
    PosVoucherSection,
    RecordEligibilitySection,
    QuickActionsSection,
    WorkAccessSection,
    SidebarVisibilitySection,
} from "@/modules/admin/components/RolePageSections";

export default function RolePage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPerms, setAllPerms] = useState<Permission[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    // Works + their groups — assigned directly to a role (not via the pool lens).
    const [works, setWorks] = useState<WorkRow[]>([]);
    const [workGroups, setWorkGroups] = useState<WorkGroupRow[]>([]);
    // Active role's department pool — `null` means all-access (no filtering: every
    // permission is offered). A Set means only those permission ids are in the lens.
    const [poolIds, setPoolIds] = useState<Set<string> | null>(null);
    const [activeRoleId, setActiveRoleId] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [original, setOriginal] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [savingRole, setSavingRole] = useState(false);
    const [savingPerms, setSavingPerms] = useState(false);
    const [newRoleOpen, setNewRoleOpen] = useState(false);
    const [newRole, setNewRole] = useState<RoleForm>(EMPTY_ROLE);
    const [copyFromRoleId, setCopyFromRoleId] = useState(NO_COPY_ROLE);
    const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
    const [search, setSearch] = useState("");

    const activeRole = roles.find((role) => role.id === activeRoleId) ?? null;

    const loadData = useCallback(async (preferredRoleId?: string) => {
        try {
            const [rolesRes, permsRes, deptsRes, worksRes, groupsRes] = await Promise.all([
                axios.get<Role[]>("/api/roles"),
                axios.get<Permission[]>("/api/permissions"),
                axios.get<Department[]>("/api/departments"),
                axios.get<WorkRow[]>("/api/works"),
                axios.get<WorkGroupRow[]>("/api/work-groups"),
            ]);
            const fetchedRoles = rolesRes.data;
            const nextActive =
                preferredRoleId && fetchedRoles.some((role) => role.id === preferredRoleId)
                    ? preferredRoleId
                    : fetchedRoles[0]?.id ?? "";

            setRoles(fetchedRoles);
            setAllPerms(permsRes.data);
            setDepartments(deptsRes.data);
            setWorks(worksRes.data);
            setWorkGroups(groupsRes.data);
            setActiveRoleId(nextActive);
        } catch {
            toast.error("Failed to load roles");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!activeRole) return;
        // Only the highest CRUD rung is STORED (customers:delete alone) — expand
        // for display so Edit + Create show ticked; save normalizes back down.
        const granted = expandCrudGrants(activeRole.permissions.map((permission) => permission.permissionId));
        setSelected(granted);
        setOriginal(new Set(granted));
        setRoleForm(roleToForm(activeRole));
        setSearch("");
    }, [activeRole]);

    // Load the active role's department pool — the authoring lens. All-access
    // departments (or a role with no department) leave poolIds null = no filter.
    const activeDeptId = activeRole?.department?.id ?? null;
    useEffect(() => {
        if (!activeDeptId) { setPoolIds(null); return; }
        let cancelled = false;
        axios
            .get<{ isAllAccess: boolean; permissionIds: string[] | null }>(`/api/departments/${activeDeptId}/permissions`)
            .then((res) => {
                if (cancelled) return;
                setPoolIds(res.data.isAllAccess || !res.data.permissionIds ? null : new Set(res.data.permissionIds));
            })
            .catch(() => { if (!cancelled) setPoolIds(null); });
        return () => { cancelled = true; };
    }, [activeDeptId]);

    const hasPermissionChanges = useMemo(() => {
        if (selected.size !== original.size) return true;
        for (const permissionId of selected) {
            if (!original.has(permissionId)) return true;
        }
        return false;
    }, [selected, original]);

    const hasRoleChanges = activeRole
        ? roleForm.label.trim() !== activeRole.label ||
        roleForm.color !== activeRole.color ||
        roleForm.rank !== activeRole.rank ||
        roleForm.departmentId !== (activeRole.department?.id ?? "")
        : false;

    const permissionById = useMemo(() => new Map(allPerms.map((permission) => [permission.id, permission])), [allPerms]);

    // Granular create/edit/delete ids unlocked because their owning sidebar link is
    // pooled. The pool carries MODULE VISIBILITY (`ui:sidebar:*`), never the granular
    // level — so without this the editor would hide a chip (e.g. "New Task") that the
    // save API would happily accept. Mirrors the same unlock the API does, keeping
    // "what the editor offers" == "what the API saves".
    const unlockedByPooledLink = useMemo(() => {
        if (poolIds === null) return null;
        return new Set(
            Object.entries(SIDEBAR_LINK_GRANULAR_IDS)
                .filter(([linkId]) => poolIds.has(linkId))
                .flatMap(([, granularIds]) => granularIds),
        );
    }, [poolIds]);

    // Department lens — a permission is offered if it's in the active role's
    // department pool (or unlocked by a pooled link). A currently-granted permission
    // is always shown (so nothing granted is ever hidden), even in the defensive
    // case it sits outside the pool.
    const inLens = useCallback(
        (id: string) =>
            POOL_EXEMPT_PERMISSION_IDS.has(id) ||
            poolIds === null ||
            poolIds.has(id) ||
            unlockedByPooledLink?.has(id) ||
            selected.has(id),
        [poolIds, unlockedByPooledLink, selected],
    );

    const filtered = (search.trim()
        ? allPerms.filter((permission) =>
            [permission.label, permission.id, permission.module, permission.description ?? ""]
                .some((value) => value.toLowerCase().includes(search.toLowerCase()))
        )
        : allPerms
    ).filter((permission) => inLens(permission.id));

    // Show the POS shift block when its perms are seeded (they are, from bootstrap).
    const posShiftChipsAvailable = POS_BLOCK_SHIFT_IDS.some((id) => permissionById.has(id));

    // Voucher matrices — gate per KIND: a kind is offered if the department pool
    // carries ANY of its ids (all-access offers every kind). Once offered, every
    // action cell (View / Open / Create / Post / Cancel / Delete) is selectable
    // independently — a role can have Create without View, etc. — and adding a new
    // action column needs no re-pooling.
    const kindOffered = (row: MatrixRow) =>
        poolIds === null ||
        Object.values(row.cells).some((permId) => typeof permId === "string" && (poolIds.has(permId) || selected.has(permId)));
    const visibleVoucherGroups = VOUCHER_ROWS_BY_GROUP
        .map((g) => ({ ...g, rows: g.rows.filter(kindOffered) }))
        .filter((g) => g.rows.length > 0);

    const selectedCount = selected.size;
    const totalCount = allPerms.length;
    // Size of the active role's lens (the pool). All-access → every permission.
    const lensSize = poolIds === null ? totalCount : allPerms.filter((p) => poolIds.has(p.id)).length;
    const lensIsAllAccess = poolIds === null;
    // Permission ids the active role may hold (its pool) — drives "Select all".
    const lensPermIds = allPerms.filter((p) => poolIds === null ? p.id !== "admin:bypass" : poolIds.has(p.id)).map((p) => p.id);
    const hasBypass = selected.has("admin:bypass");

    const handleTabChange = (roleId: string) => {
        if (hasPermissionChanges && !confirm("Discard unsaved permission changes?")) return;
        setActiveRoleId(roleId);
    };

    const handleCreate = async () => {
        if (!newRole.label.trim()) {
            toast.error("Role name is required");
            return;
        }
        if (!newRole.departmentId) {
            toast.error("Select a department for the role");
            return;
        }

        setSavingRole(true);
        try {
            const res = await axios.post<Role>("/api/roles", newRole);
            if (copyFromRoleId !== NO_COPY_ROLE) {
                const sourceRole = roles.find((role) => role.id === copyFromRoleId);
                const permissionIds = sourceRole?.permissions.map((permission) => permission.permissionId) ?? [];
                await axios.put(`/api/roles/${res.data.id}/permissions`, { permissionIds });
            }
            toast.success("Role created");
            setNewRoleOpen(false);
            setNewRole(EMPTY_ROLE);
            setCopyFromRoleId(NO_COPY_ROLE);
            await loadData(res.data.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to create role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleUpdateRole = async () => {
        if (!activeRole) return;
        if (!roleForm.label.trim()) {
            toast.error("Role name is required");
            return;
        }

        setSavingRole(true);
        try {
            await axios.patch(`/api/roles/${activeRole.id}`, {
                label: roleForm.label,
                color: roleForm.color,
                rank: roleForm.rank,
                departmentId: roleForm.departmentId,
            });
            toast.success("Role updated");
            await loadData(activeRole.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to update role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleDelete = async (role: Role) => {
        if (!confirm(`Delete ${role.label}? Users assigned this role will lose it.`)) return;

        try {
            await axios.delete(`/api/roles/${role.id}`);
            toast.success("Role deleted");
            const nextRole = roles.find((item) => item.id !== role.id)?.id;
            await loadData(nextRole);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to delete role"));
        }
    };

    const handleSavePermissions = async () => {
        if (!activeRole) return;

        setSavingPerms(true);
        try {
            await axios.put(`/api/roles/${activeRole.id}/permissions`, {
                // Persist only the highest CRUD rung per resource — ticked lowers
                // are implied at check time, so storing them would just bloat
                // grants + the session token.
                permissionIds: [...normalizeCrudGrants(selected)],
            });
            setOriginal(new Set(selected));
            toast.success("Permissions saved");
            await loadData(activeRole.id);
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSavingPerms(false);
        }
    };

    const handleDiscardPermissions = () => setSelected(new Set(original));

    // CRUD ladder cascade — mirrors the session expansion (crudLadder.ts):
    // ticking Delete auto-ticks Edit + Create; unticking a lower action also
    // unticks the highers that imply it (else the boxes would lie about what a
    // holder actually gets). Non-CRUD ids toggle alone.
    const togglePerm = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                for (const higher of crudDependentsOnRevoke(id)) next.delete(higher);
            } else {
                next.add(id);
                for (const lower of crudImpliedByGrant(id)) next.add(lower);
            }
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading roles...
            </div>
        );
    }

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-3 px-6 pt-3 pb-8 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-foreground">
                            Roles &amp; Permissions
                        </h1>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Create roles, edit role details, and manage permissions from one page.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => {
                            // Default to the first functional (non-all-access) department so new
                            // roles get a narrow lens by default, not the full permission list.
                            setNewRole({ ...EMPTY_ROLE, departmentId: departments.find((d) => !d.isAllAccess)?.id ?? departments[0]?.id ?? "" });
                            setNewRoleOpen(true);
                        }}
                    >
                        <Plus /> New Role
                    </Button>
                </div>

                {roles.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                            <Shield size={36} className="opacity-20" />
                            <p className="text-sm">No roles found. Create one to get started.</p>
                        </CardContent>
                    </Card>
                ) : activeRole && (
                    <>
                        <RoleDetailsCard
                            role={activeRole}
                            form={roleForm}
                            departments={departments}
                            selectedCount={selectedCount}
                            totalCount={totalCount}
                            saving={savingRole}
                            hasChanges={hasRoleChanges}
                            onFormChange={setRoleForm}
                            onSave={handleUpdateRole}
                            onDiscard={() => setRoleForm(roleToForm(activeRole))}
                            onDelete={() => handleDelete(activeRole)}
                        />

                        <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
                            <aside className="xl:sticky xl:top-6 xl:self-start">
                                <RoleList
                                    roles={roles}
                                    activeRoleId={activeRoleId}
                                    totalCount={totalCount}
                                    onSelect={handleTabChange}
                                />
                            </aside>

                            <section className="min-w-0 space-y-3">
                                <Card>
                                    <CardContent className="space-y-3 pt-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <h2 className="text-base font-bold tracking-tight">
                                                    Role: {activeRole.label} <Badge className={`${activeRole.color} ml-2`}>{activeRole.id}</Badge>
                                                </h2>
                                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                                    {activeRole._count.users} {activeRole._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions selected. Changes apply on next login.
                                                </p>
                                            </div>
                                            <div className="flex gap-1.5">
                                                <Button
                                                    size="sm"
                                                    onClick={handleSavePermissions}
                                                    disabled={savingPerms || !hasPermissionChanges}
                                                >
                                                    <Save size={14} />
                                                    {savingPerms ? "Saving..." : "Save permissions"}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleDiscardPermissions}
                                                    disabled={!hasPermissionChanges}
                                                >
                                                    <RotateCcw size={14} />
                                                    Discard
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11px] dark:border-blue-900 dark:bg-blue-950/30">
                                            <Boxes size={13} className="shrink-0 text-blue-600 dark:text-blue-400" />
                                            {lensIsAllAccess ? (
                                                <span className="text-foreground">
                                                    <span className="font-semibold">{activeRole.department?.name ?? "Administration"}</span>
                                                    {` is all-access — all ${totalCount} permissions are available.`}
                                                </span>
                                            ) : (
                                                <span className="text-foreground">
                                                    {"Lens: "}
                                                    <span className="font-semibold">{activeRole.department?.name ?? "—"}</span>
                                                    {` department · showing ${lensSize} of ${totalCount} permissions in its pool. `}
                                                    <span className="text-muted-foreground">Edit the pool on the Departments page.</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                                            <div className="relative min-w-64 flex-1">
                                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    value={search}
                                                    onChange={(event) => setSearch(event.target.value)}
                                                    placeholder="Search permissions by name, module, or ID..."
                                                    className="h-7 pl-8 text-xs"
                                                />
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelected(new Set(lensPermIds))}
                                            >
                                                Select all
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelected(new Set())}
                                            >
                                                Clear all
                                            </Button>
                                        </div>

                                        {hasBypass && (
                                            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                                                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
                                                <p className="text-[11px] leading-relaxed text-destructive">
                                                    <span className="font-semibold">admin:bypass active.</span>{" "}
                                                    This role skips every permission check in the system.
                                                </p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="space-y-3 pt-4">
                                        {filtered.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                                <Search size={32} className="mb-3 opacity-20" />
                                                <p className="text-sm">No permissions match your search.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {visibleVoucherGroups.map((group) => (
                                                    <SharedPermissionMatrix
                                                        key={group.key}
                                                        title={`${group.label} — eligibility`}
                                                        description="Per voucher kind: view / open (read) and create / post / cancel (= edit) / delete (write). Each is independent — a role can have Create without View."
                                                        rows={group.rows}
                                                        columnGroups={VOUCHER_COLUMN_GROUPS}
                                                        selected={selected}
                                                        onTogglePerm={togglePerm}
                                                        collapsible
                                                        defaultOpen={false}
                                                    />
                                                ))}
                                                <RecordEligibilitySection
                                                    selected={selected}
                                                    onTogglePerm={togglePerm}
                                                    rowOffered={kindOffered}
                                                />
                                            </div>
                                        )}
                                    </CardContent>

                                    <QuickActionsSection
                                        selected={selected}
                                        original={original}
                                        onTogglePerm={togglePerm}
                                        inLens={inLens}
                                    />
                                </Card>

                                <PosVoucherSection
                                    selected={selected}
                                    original={original}
                                    setSelected={setSelected}
                                    onTogglePerm={togglePerm}
                                    posShiftChipsAvailable={posShiftChipsAvailable}
                                />


                                <SidebarVisibilitySection
                                    selected={selected}
                                    original={original}
                                    search={search}
                                    inLens={inLens}
                                    onTogglePerm={togglePerm}
                                />

                                <WorkAccessSection
                                    works={works}
                                    groups={workGroups}
                                    selected={selected}
                                    original={original}
                                    search={search}
                                    onTogglePerm={togglePerm}
                                />
                            </section>
                        </div>
                    </>
                )}

                <NewRoleDialog
                    open={newRoleOpen}
                    onOpenChange={setNewRoleOpen}
                    roles={roles}
                    departments={departments}
                    form={newRole}
                    copyFromRoleId={copyFromRoleId}
                    saving={savingRole}
                    onFormChange={setNewRole}
                    onCopyFromRoleChange={setCopyFromRoleId}
                    onCreate={handleCreate}
                    onCancel={() => {
                        setNewRoleOpen(false);
                        setNewRole(EMPTY_ROLE);
                        setCopyFromRoleId(NO_COPY_ROLE);
                    }}
                />
            </div>
        </ScrollArea>
    );
}

