"use client";

// ── Role-page sections ────────────────────────────────────────────────────────
// The self-contained sub-components of office/admin/role/page.tsx, moved out
// verbatim so the page keeps only its state + layout. Each section receives
// everything it needs via props.


import React, { useState } from "react";
import {
    Check,
    ChevronDown,
    ClipboardList,
    Lock,
    PanelLeft,
    Plus,
    RotateCcw,
    Save,
    Shield,
    ShoppingCart,
    Trash2,
    Users,
    Globe,
    Eye,
    PencilLine,
    Zap,
    Filter,
    Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionMatrix as SharedPermissionMatrix } from "@/shared/components/PermissionMatrix";
import { SIDEBAR_MODULES, type SidebarChildRow } from "@/shared/lib/auth/sidebarModules";
import {
    POS_VISIBILITY_ID,
    POS_MATRIX_ROWS,
    POS_COLUMN_GROUPS,
    POS_OPERATOR_SHIFT_CHIPS,
    QUICK_ACTION_OPTIONS,
    COLOR_OPTIONS,
    ROLE_ACCENT,
    NO_COPY_ROLE,
    MATRIX_ROWS,
    CORE_MATRIX_COLUMN_GROUPS,
    RECORD_ELIGIBILITY_ROWS,
    INLINE_HIDDEN_MATRIX_ROW_KEYS,
    toSharedMatrixRow,
    SIDEBAR_LINK_MATRIX_ROW_KEY,
    extraTogglesFor,
    MODULE_EXTRA_TOGGLE,
    RISKY_PERMISSION_IDS,
    type WorkRow,
    type WorkGroupRow,
    type Department,
    type Role,
    type RoleForm,
} from "@/modules/admin/lib/roleMatrixConfig";
import type { MatrixRow } from "@/shared/components/PermissionMatrix";

export function RoleFields({
    form,
    onChange,
    departments,
}: {
    form: RoleForm;
    onChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    departments: Department[];
}) {
    const selectedDept = departments.find((d) => d.id === form.departmentId);
    return (
        <div className="space-y-2">
            <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Department <span className="font-normal">(the basket — which modules this role can tick)</span>
                </label>
                <Select
                    value={form.departmentId || undefined}
                    onValueChange={(value) => onChange((prev) => ({ ...prev, departmentId: value }))}
                >
                    <SelectTrigger className="h-7 w-full text-xs">
                        <SelectValue placeholder="Select a department…" />
                    </SelectTrigger>
                    <SelectContent>
                        {departments.map((dept) => (
                            <SelectItem key={dept.id} value={dept.id}>
                                {dept.name}{dept.isAllAccess ? " · all-access" : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {selectedDept && !selectedDept.isAllAccess && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                        Only the modules in {selectedDept.name}&apos;s basket are offered here — the basket decides what is shown, never what is saved. Moving a role to another department strips grants outside the new basket.
                    </p>
                )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_78px_minmax(160px,1fr)]">
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Role name
                    </label>
                    <Input
                        value={form.label}
                        onChange={(event) => onChange((prev) => ({ ...prev, label: event.target.value }))}
                        placeholder="e.g. Senior Technician"
                        className="h-7 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Rank
                    </label>
                    <Input
                        type="text"
                        inputMode="numeric"
                        value={form.rank}
                        onChange={(event) => onChange((prev) => ({ ...prev, rank: Number(event.target.value) }))}
                        className="h-7 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Colour
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {COLOR_OPTIONS.map((color) => (
                            <Button
                                key={color.value}
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                title={color.label}
                                onClick={() => onChange((prev) => ({ ...prev, color: color.value }))}
                                className={[
                                    "h-6 w-6 rounded-md border p-0 transition-all duration-150",
                                    color.dot,
                                    form.color === color.value
                                        ? "scale-105 border-foreground ring-1 ring-border ring-offset-1"
                                        : "border-transparent hover:scale-105 hover:border-border",
                                ].join(" ")}
                            />
                        ))}
                        {form.label && <Badge className={`${form.color} ml-2`}>{form.label}</Badge>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function RoleDetailsCard({
    role,
    form,
    departments,
    selectedCount,
    totalCount,
    saving,
    hasChanges,
    onFormChange,
    onSave,
    onDiscard,
    onDelete,
}: {
    role: Role;
    form: RoleForm;
    departments: Department[];
    selectedCount: number;
    totalCount: number;
    saving: boolean;
    hasChanges: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onSave: () => void;
    onDiscard: () => void;
    onDelete: () => void;
}) {
    return (
        <Card className={`border-l-4 ${ROLE_ACCENT[form.color] ?? "border-l-gray-300"}`}>
            <CardContent className="grid gap-3 pt-4 lg:grid-cols-[minmax(160px,0.7fr)_minmax(300px,1.5fr)_auto] lg:items-end">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={`${role.color} font-mono text-xs`}>{role.id}</Badge>
                        {role.isSystem && (
                            <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                <Lock size={9} /> System
                            </span>
                        )}
                    </div>
                    <div>
                        <p className="text-base font-bold leading-tight text-foreground">{role.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {role._count.users} {role._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions
                        </p>
                        {role.department && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">{role.department.name}</span> department
                                {role.department.isAllAccess ? " · all-access" : ""}
                            </p>
                        )}
                    </div>
                </div>

                <RoleFields form={form} onChange={onFormChange} departments={departments} />

                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                    <Button
                        size="sm"
                        onClick={onSave}
                        disabled={saving || !hasChanges || !form.label.trim()}
                    >
                        <Save size={14} />
                        {saving ? "Saving..." : "Save role"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onDiscard}
                        disabled={!hasChanges}
                    >
                        <RotateCcw size={14} />
                    </Button>
                    {!role.isSystem && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={onDelete}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete role"
                        >
                            <Trash2 size={14} />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

export function NewRoleDialog({
    open,
    onOpenChange,
    roles,
    departments,
    form,
    copyFromRoleId,
    saving,
    onFormChange,
    onCopyFromRoleChange,
    onCreate,
    onCancel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    roles: Role[];
    departments: Department[];
    form: RoleForm;
    copyFromRoleId: string;
    saving: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onCopyFromRoleChange: (roleId: string) => void;
    onCreate: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create New Role</DialogTitle>
                    <DialogDescription>
                        Create the role details and optionally start with permissions copied from an existing role.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <RoleFields form={form} onChange={onFormChange} departments={departments} />

                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Copy permissions from
                        </label>
                        <Select value={copyFromRoleId} onValueChange={onCopyFromRoleChange}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Start with no copied permissions" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_COPY_ROLE}>No copied permissions</SelectItem>
                                {roles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                        {role.label} ({role.id})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            The new role will be created first, then the copied permission set will be applied with the existing API.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button disabled={saving || !form.label.trim()} onClick={onCreate}>
                        {saving ? "Creating..." : "Create Role"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RoleList({
    roles,
    activeRoleId,
    totalCount,
    onSelect,
}: {
    roles: Role[];
    activeRoleId: string;
    totalCount: number;
    onSelect: (roleId: string) => void;
}) {
    return (
        <Card>
            <CardContent className="space-y-2 pt-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Roles
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Select a role to edit its details and permissions.
                    </p>
                </div>

                <div className="space-y-1">
                    {roles.map((role) => {
                        const isActive = role.id === activeRoleId;
                        const permissionCount = role.permissions.length;
                        const accent = ROLE_ACCENT[role.color] ?? "border-l-gray-300";

                        return (
                            <Button
                                key={role.id}
                                type="button"
                                variant="ghost"
                                onClick={() => onSelect(role.id)}
                                className={[
                                    "group h-auto w-full justify-start rounded-md border border-l-4 bg-background px-2 py-1.5 text-left transition-all",
                                    accent,
                                    isActive
                                        ? "border-primary shadow-sm"
                                        : "border-border hover:border-primary/50 hover:bg-muted/40",
                                ].join(" ")}
                            >
                                <div className="flex w-full min-w-0 flex-col gap-1 whitespace-normal">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                            <Badge className={`${role.color} font-mono text-[10px]`}>
                                                {role.id}
                                            </Badge>
                                            {role.isSystem && (
                                                <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                    <Lock size={9} /> System
                                                </span>
                                            )}
                                        </div>
                                        {isActive && (
                                            <span className="shrink-0 text-[10px] font-medium text-primary">Active</span>
                                        )}
                                    </div>
                                    <p className="truncate text-xs font-semibold text-foreground">
                                        {role.label}
                                    </p>
                                    {role.department && (
                                        <p className="truncate text-[10px] text-muted-foreground" title="Authoring department">
                                            {role.department.name}{role.department.isAllAccess ? " · all-access" : ""}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5">
                                            <Users size={10} />
                                            {role._count.users}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5">
                                            <Shield size={10} />
                                            {permissionCount}/{totalCount}
                                        </span>
                                        <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5">
                                            Rank {role.rank}
                                        </span>
                                    </div>
                                </div>
                            </Button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

// The role's Quick Actions picker — flex list of everything creatable (vouchers +
// POS is a separate UI (/vouchers/pos) with its own voucher lifecycle and
// operator shift/till controls — kept in its own card, not mixed into the
// office voucher matrices above, so the two surfaces read as distinct.
export function PosVoucherSection({
    selected,
    original,
    setSelected,
    onTogglePerm,
    posShiftChipsAvailable,
}: {
    selected: Set<string>;
    original: Set<string>;
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
    onTogglePerm: (id: string) => void;
    posShiftChipsAvailable: boolean;
}) {
    // Only relevant once the role can see POS at all (the workspace visibility toggle).
    if (!selected.has(POS_VISIBILITY_ID)) return null;
    return (
        <Card className="border-green-200 dark:border-green-900">
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <ShoppingCart size={15} className="text-green-700 dark:text-green-400" /> Point of Sale
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Separate from office vouchers — gates the /vouchers/pos UI and the operator&rsquo;s own shift &amp; till.
                    </p>
                </div>
                <SharedPermissionMatrix
                    title="POS vouchers — /vouchers/pos UI only"
                    description="Per POS voucher kind: create / cancel (= edit) / delete (no post — POS has no draft; being able to create implies it's visible). Office-equivalent voucher permission also grants each (office ⊇ POS)."
                    rows={POS_MATRIX_ROWS}
                    columnGroups={POS_COLUMN_GROUPS}
                    selected={selected}
                    onTogglePerm={onTogglePerm}
                    collapsible
                    defaultOpen={false}
                />
                {posShiftChipsAvailable && (
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="border-b border-border bg-muted/40 px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">POS Shift &amp; Till</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Operator actions on their own counter — start/end their shift (open implies close), drop cash to the safe, and send a customer a UPI payment request on WhatsApp. Oversight (manage, view other branches) is a separate management concern.</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                            {POS_OPERATOR_SHIFT_CHIPS.map((chip) => {
                                // Each chip toggles its id(s) together (Start/End = open + close).
                                const on = chip.ids.every((id) => selected.has(id));
                                const changed = chip.ids.some((id) => selected.has(id) !== original.has(id));
                                return (
                                    <Button
                                        key={chip.label}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setSelected((prev) => {
                                                const next = new Set(prev);
                                                const all = chip.ids.every((id) => next.has(id));
                                                chip.ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
                                                return next;
                                            })
                                        }
                                        title={`${chip.label} — grants ${chip.ids.join(" + ")}`}
                                        className={[
                                            "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                            on
                                                ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                                : "border-border hover:border-primary/60 hover:bg-primary/5",
                                            changed ? "ring-2 ring-primary/20" : "",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                                on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                            ].join(" ")}
                                        >
                                            {on && <Check size={10} strokeWidth={3} />}
                                        </span>
                                        <span className="text-[11px] font-medium leading-tight">{chip.label}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// Non-voucher, user-creatable "record" resources — repair tickets, help tickets,
// deals, tasks, contacts — as one create/edit/delete matrix, same visual language
// as the voucher eligibility cards right above it. Sits directly above Quick
// Actions so a role's create "+" chip and its actual edit/delete grant read as
// one decision, instead of hunting for it under Sidebar links further down.
export function RecordEligibilitySection({
    selected,
    onTogglePerm,
    rowOffered,
}: {
    selected: Set<string>;
    onTogglePerm: (id: string) => void;
    // Department-pool gate, same rule as the voucher matrices: a row is offered if
    // the pool carries ANY of its ids (or the role is all-access / already holds one).
    rowOffered: (row: MatrixRow) => boolean;
}) {
    const rows = RECORD_ELIGIBILITY_ROWS.filter(rowOffered);
    if (rows.length === 0) return null;
    return (
        <SharedPermissionMatrix
            title="Records — eligibility"
            description="Create / edit / delete for non-voucher records — repair tickets, help tickets, deals, tasks and contacts. Each is independent — a role can have Create without Edit."
            rows={rows}
            columnGroups={CORE_MATRIX_COLUMN_GROUPS}
            selected={selected}
            onTogglePerm={onTogglePerm}
            collapsible
            defaultOpen={false}
        />
    );
}

// Repair + POS). Ticking a chip grants that create permission, which makes the "+"
// show in the role's button bar. Reads/writes the same `selected` set as the
// matrix, so the two views stay in sync.
export function QuickActionsSection({
    selected,
    original,
    onTogglePerm,
    inLens,
}: {
    selected: Set<string>;
    original: Set<string>;
    onTogglePerm: (id: string) => void;
    // Department-pool lens: a chip is offered only if its create permission is in
    // the pool (or already granted, so nothing granted is ever hidden). Keeps this
    // bar in step with the voucher matrix, which is pool-gated per kind.
    inLens: (id: string) => boolean;
}) {
    const options = QUICK_ACTION_OPTIONS.filter((opt) => inLens(opt.permission));
    // Nothing creatable in this department's pool → drop the whole card (no empty header).
    if (options.length === 0) return null;
    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <Plus size={15} /> Quick Actions
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Tick what this role can create — each shows as a &ldquo;+&rdquo; in the role&rsquo;s Quick Actions bar. Ticking grants that create permission.
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {options.map((opt) => {
                        const Icon = opt.icon;
                        // A chip that grants several ids (POS + = open + close) is on only
                        // when all are, and flips them together.
                        const isOn = opt.ids.every((id) => selected.has(id));
                        const changed = opt.ids.some((id) => selected.has(id) !== original.has(id));
                        return (
                            <Button
                                key={opt.permission}
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => opt.ids.forEach((id) => { if (selected.has(id) === isOn) onTogglePerm(id); })}
                                title={opt.ids.join(" + ")}
                                className={[
                                    "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                    isOn
                                        ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                        : "border-border hover:border-primary/60 hover:bg-primary/5",
                                    changed ? "ring-2 ring-primary/20" : "",
                                ].join(" ")}
                            >
                                <span
                                    className={[
                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                        isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                    ].join(" ")}
                                >
                                    {isOn && <Check size={10} strokeWidth={3} />}
                                </span>
                                <Icon size={13} className="shrink-0 text-muted-foreground" />
                                <span className="text-[11px] font-medium leading-tight">{opt.label}</span>
                            </Button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

// The role's direct Work assignment. Lists every work grouped by its Work Group
// (friendly sorting only — groups carry no access). Ticking a *gated* work grants
// its `work:<id>` permission; ungated works are open to all and shown read-only.
// This list is NOT filtered by the department pool — works are assigned directly.
export function WorkAccessSection({
    works,
    groups,
    selected,
    original,
    search,
    onTogglePerm,
}: {
    works: WorkRow[];
    groups: WorkGroupRow[];
    selected: Set<string>;
    original: Set<string>;
    search: string;
    onTogglePerm: (id: string) => void;
}) {
    // Only gated, human works are hand-assigned: auto works (Actions) run by
    // themselves, and ungated works are open to all so there's nothing to grant.
    const assignableWorks = works.filter((w) => w.kind !== "auto" && w.permissionId);
    const term = search.trim().toLowerCase();
    const matched = term
        ? assignableWorks.filter((w) => `${w.label} ${w.permissionId ?? ""}`.toLowerCase().includes(term))
        : assignableWorks;

    if (assignableWorks.length === 0) return null;

    // Ordered buckets: known groups by their order, then an "Ungrouped" catch-all.
    const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
    const buckets: { id: string | null; label: string; color: string | null; works: WorkRow[] }[] = [
        ...orderedGroups.map((g) => ({ id: g.id, label: g.label, color: g.color, works: matched.filter((w) => w.groupIds.includes(g.id)) })),
        { id: null, label: "Ungrouped", color: null, works: matched.filter((w) => !w.groupIds.some((gid) => groups.some((g) => g.id === gid))) },
    ].filter((b) => b.works.length > 0);

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <ClipboardList size={15} /> Works
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Assigned directly to the role — not filtered by the department pool. Tick a work to let this role act on it in the Work Inbox. Groups are sorting only.
                    </p>
                </div>

                {buckets.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground">No works match your search.</p>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
                        {buckets.map((bucket) => (
                            <div key={bucket.id ?? "__ungrouped__"} className="px-3 py-2.5">
                                <div className="mb-1.5 flex items-center gap-2">
                                    {bucket.color ? (
                                        <Badge className={`${bucket.color} text-[10px]`}>{bucket.label}</Badge>
                                    ) : (
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{bucket.label}</span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground">
                                        {bucket.works.length} {bucket.works.length === 1 ? "work" : "works"}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {bucket.works.map((work) => {
                                        const permId = work.permissionId;
                                        if (!permId) return null; // filtered out above; guard narrows the type
                                        const isOn = selected.has(permId);
                                        const changed = isOn !== original.has(permId);
                                        return (
                                            <Button
                                                key={work.id}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => onTogglePerm(permId)}
                                                title={`${work.label} (${permId})`}
                                                className={[
                                                    "h-auto items-start gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                                    isOn
                                                        ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                                        : "border-border hover:border-primary/60 hover:bg-primary/5",
                                                    changed ? "ring-2 ring-primary/20" : "",
                                                ].join(" ")}
                                            >
                                                <span
                                                    className={[
                                                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                                        isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                                    ].join(" ")}
                                                >
                                                    {isOn && <Check size={10} strokeWidth={3} />}
                                                </span>
                                                <span className="flex flex-col">
                                                    <span className="text-[11px] font-medium leading-tight">{work.label}</span>
                                                    <span className="text-[10px] leading-tight text-muted-foreground">{permId}</span>
                                                </span>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// The role's sidebar link picker — "goes inside" each module the department pool
// offers and lists its next-level nav labels. Ticking a link grants its
// `ui:sidebar:<module>:<child>` permission, so the link shows in the role's
// sidebar. Modules outside the department pool offer no links and are dropped, so
// a role only sees links inside the modules its department allows.
// The four kinds of permission a module carries, each in its own lane so a
// "can open the page" tick never sits beside a "can do this" tick:
//   Pages            — ui:sidebar:* links (nested sub-nav keeps its tree)
//   Add / Edit / Delete — the CRUD matrix rows the ticked links unlock
//   Special actions  — the per-link extra yes/no ticks (send, reset, change tax…)
//   What they can see — module-wide toggles that widen or narrow the data shown
const LANE_STYLE = {
    pages: { icon: Eye, title: "Pages", hint: "Shows the link in the sidebar. Everything below needs its page ticked.", bar: "border-l-blue-500", tint: "bg-blue-500/10 text-blue-700 dark:text-blue-300", on: "border-blue-500 bg-blue-500/10", box: "border-blue-500 bg-blue-500" },
    crud: { icon: PencilLine, title: "Add / Edit / Delete", hint: "Change records on the ticked pages. Each column is separate.", bar: "border-l-emerald-500", tint: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", on: "border-emerald-500 bg-emerald-500/10", box: "border-emerald-500 bg-emerald-500" },
    special: { icon: Zap, title: "Special actions", hint: "One powerful button each. RISKY ones reach many customers, move money or reset data.", bar: "border-l-amber-500", tint: "bg-amber-500/10 text-amber-700 dark:text-amber-300", on: "border-amber-500 bg-amber-500/10", box: "border-amber-500 bg-amber-500" },
    see: { icon: Filter, title: "What they can see", hint: "Widens or narrows the data shown inside the pages.", bar: "border-l-violet-500", tint: "bg-violet-500/10 text-violet-700 dark:text-violet-300", on: "border-violet-500 bg-violet-500/10", box: "border-violet-500 bg-violet-500" },
} as const;
type LaneKind = keyof typeof LANE_STYLE;

function PermTick({
    id,
    label,
    kind,
    selected,
    original,
    describe,
    onTogglePerm,
    note,
}: {
    id: string;
    label: string;
    kind: LaneKind;
    selected: Set<string>;
    original: Set<string>;
    describe: (id: string) => string | undefined;
    onTogglePerm: (id: string) => void;
    note?: string;
}) {
    const on = selected.has(id);
    const changed = on !== original.has(id);
    const style = LANE_STYLE[kind];
    const desc = describe(id);
    const risky = RISKY_PERMISSION_IDS.has(id);
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onTogglePerm(id)}
            title={[label, desc, note, id].filter(Boolean).join("\n\n")}
            aria-pressed={on}
            className={[
                "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                on ? style.on : "border-border hover:border-primary/60 hover:bg-primary/5",
                changed ? "ring-2 ring-primary/25" : "",
            ].join(" ")}
        >
            <span
                className={[
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? `${style.box} text-white` : "border-border",
                ].join(" ")}
            >
                {on && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="text-[11px] font-medium leading-tight">{label}</span>
            {risky && (
                <span className="rounded border border-destructive px-1 text-[9px] font-bold tracking-wide text-destructive">RISKY</span>
            )}
            {note && <span className="text-[10px] font-normal text-muted-foreground">{note}</span>}
            {desc && <Info size={11} className="shrink-0 text-muted-foreground" />}
        </Button>
    );
}

function Lane({ kind, children }: { kind: LaneKind; children: React.ReactNode }) {
    const style = LANE_STYLE[kind];
    const Icon = style.icon;
    return (
        <div className={`grid gap-2 border-l-[3px] border-t border-t-border px-3 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] ${style.bar}`}>
            <div className="flex items-start gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${style.tint}`}>
                    <Icon size={13} />
                </span>
                <p className="pt-1 text-[12px] font-semibold leading-tight" title={style.hint}>{style.title}</p>
            </div>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function SidebarVisibilitySection({
    selected,
    original,
    search,
    inLens,
    describe,
    onTogglePerm,
}: {
    selected: Set<string>;
    original: Set<string>;
    search: string;
    inLens: (id: string) => boolean;
    describe: (id: string) => string | undefined;
    onTogglePerm: (id: string) => void;
}) {
    const term = search.trim().toLowerCase();
    const [closed, setClosed] = useState<Set<string>>(new Set());
    const toggleModule = (key: string) =>
        setClosed((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    // Gate per MODULE, not per link: a module is offered if the department pool
    // carries ANY of its links (all-access pools offer everything; Workspace is
    // always offered). Once offered, EVERY current link from constants shows — so
    // adding a nav item (or sub-nav) appears automatically, no re-pooling needed.
    // Then prune by the search term (link label or any of its action labels),
    // keeping ancestors of a match.
    const modules = SIDEBAR_MODULES
        .map((mod) => {
            const moduleOffered = !mod.pooled || mod.childPermissionIds.some((id) => inLens(id));
            if (!moduleOffered) return { ...mod, children: [] as SidebarChildRow[] };
            const moduleMatch = !term || mod.label.toLowerCase().includes(term);
            const nodeMatch = (node: SidebarChildRow) =>
                node.label.toLowerCase().includes(term) ||
                extraTogglesFor(node.permissionId).some((t) => t.label.toLowerCase().includes(term));
            const prune = (nodes: SidebarChildRow[]): SidebarChildRow[] =>
                nodes.reduce<SidebarChildRow[]>((acc, node) => {
                    const kids = node.children ? prune(node.children) : undefined;
                    const keep = moduleMatch || nodeMatch(node) || (!!kids && kids.length > 0);
                    if (keep) acc.push({ ...node, children: kids && kids.length ? kids : undefined });
                    return acc;
                }, []);
            return { ...mod, children: prune(mod.children) };
        })
        .filter((mod) => mod.children.length > 0);

    if (modules.length === 0) return null;

    const flatten = (nodes: SidebarChildRow[]): SidebarChildRow[] =>
        nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);

    // Pages lane — leaves wrap in a row; a parent shows its own tick then, once
    // ticked, an indented block of its children (a child shows only under a
    // checked parent).
    const renderPages = (nodes: SidebarChildRow[]): React.ReactNode => {
        const leaves = nodes.filter((n) => !n.children?.length);
        const parents = nodes.filter((n) => n.children?.length);
        return (
            <div className="space-y-1.5">
                {leaves.length > 0 && (
                    <div className="flex flex-wrap items-start gap-1.5">
                        {leaves.map((n) => (
                            <PermTick key={n.permissionId} id={n.permissionId} label={n.label} kind="pages"
                                selected={selected} original={original} describe={describe} onTogglePerm={onTogglePerm} />
                        ))}
                    </div>
                )}
                {parents.map((p) => (
                    <div key={p.permissionId} className="space-y-1">
                        <PermTick id={p.permissionId} label={p.label} kind="pages"
                            selected={selected} original={original} describe={describe} onTogglePerm={onTogglePerm} />
                        {selected.has(p.permissionId) && (
                            <div className="ml-3 border-l border-border pl-2.5">{renderPages(p.children!)}</div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <PanelLeft size={15} /> Modules — pages and what they can do there
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Each module is split by kind of permission. Tick a page first; its add / edit / delete and special actions then appear below it. Hover any tick to read what it allows. Workspace is always available; other modules appear only if the role&rsquo;s department pool offers them.
                    </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {(Object.keys(LANE_STYLE) as LaneKind[]).map((k) => {
                        const s = LANE_STYLE[k];
                        const Icon = s.icon;
                        return (
                            <div key={k} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${s.tint}`}><Icon size={13} /></span>
                                <div>
                                    <p className="text-[12px] font-semibold leading-tight">{s.title}</p>
                                    <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{s.hint}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    {modules.map((mod) => {
                        const links = flatten(mod.children);
                        const ticked = links.filter((n) => selected.has(n.permissionId));

                        // CRUD rows unlocked by the ticked links (deduped — Products and
                        // Item Ledger share one row). The five record rows live in the
                        // Records card above; this lane points there instead.
                        const crudRows: (typeof MATRIX_ROWS)[number][] = [];
                        let recordsElsewhere = false;
                        for (const n of ticked) {
                            const rowKey = SIDEBAR_LINK_MATRIX_ROW_KEY[n.permissionId];
                            if (!rowKey) continue;
                            if (INLINE_HIDDEN_MATRIX_ROW_KEYS.has(rowKey)) { recordsElsewhere = true; continue; }
                            const row = MATRIX_ROWS.find((r) => r.key === rowKey);
                            if (row && !crudRows.some((r) => r.key === row.key)) crudRows.push(row);
                        }
                        const hasCrud = links.some((n) => SIDEBAR_LINK_MATRIX_ROW_KEY[n.permissionId]);

                        // Special actions — one tick per id, labelled with the page it sits on.
                        const specials: { id: string; label: string; page: string }[] = [];
                        for (const n of ticked) {
                            for (const t of extraTogglesFor(n.permissionId)) {
                                if (!specials.some((s) => s.id === t.id)) specials.push({ ...t, page: n.label });
                            }
                        }
                        const hasSpecial = links.some((n) => extraTogglesFor(n.permissionId).length > 0);

                        const modToggle = MODULE_EXTRA_TOGGLE[mod.key];
                        const showSee = !!modToggle && !modToggle.global && modToggle.showWhenAnyLinkId.some((id) => selected.has(id));
                        const hasSee = !!modToggle && !modToggle.global;

                        const crudIds = crudRows.flatMap((r) => Object.values(toSharedMatrixRow(r).cells).filter((id): id is string => !!id));
                        const isClosed = closed.has(mod.key) && !term;
                        const pill = (k: LaneKind, text: string) => (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${LANE_STYLE[k].tint}`}>{text}</span>
                        );

                        return (
                            <div key={mod.key} className="overflow-hidden rounded-lg border border-border bg-card">
                                <button
                                    type="button"
                                    onClick={() => toggleModule(mod.key)}
                                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                                >
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{mod.label}</span>
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        {pill("pages", `${ticked.length}/${links.length} ${mod.unit ?? "pages"}`)}
                                        {hasCrud && crudIds.length > 0 && pill("crud", `${new Set(crudIds.filter((id) => selected.has(id))).size}/${new Set(crudIds).size} add·edit·delete`)}
                                        {hasSpecial && specials.length > 0 && pill("special", `${specials.filter((s) => selected.has(s.id)).length}/${specials.length} special`)}
                                        <ChevronDown size={14} className={["text-muted-foreground transition-transform", isClosed ? "-rotate-90" : ""].join(" ")} />
                                    </span>
                                </button>
                                {!isClosed && (
                                    <div>
                                        {mod.note && <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{mod.note}</p>}
                                        <Lane kind="pages">{renderPages(mod.children)}</Lane>
                                        {hasCrud && (
                                            <Lane kind="crud">
                                                {crudRows.length > 0 && (
                                                    <SharedPermissionMatrix
                                                        rows={crudRows.map(toSharedMatrixRow)}
                                                        columnGroups={CORE_MATRIX_COLUMN_GROUPS}
                                                        selected={selected}
                                                        onTogglePerm={onTogglePerm}
                                                    />
                                                )}
                                                {recordsElsewhere && (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">Add / edit / delete for this module&rsquo;s records is in the Records card above.</p>
                                                )}
                                                {crudRows.length === 0 && !recordsElsewhere && (
                                                    <p className="text-[11px] text-muted-foreground">Tick a page above to choose what they can add, edit or delete there.</p>
                                                )}
                                            </Lane>
                                        )}
                                        {hasSpecial && (
                                            <Lane kind="special">
                                                {specials.length > 0 ? (
                                                    <div className="flex flex-wrap items-start gap-1.5">
                                                        {specials.map((s) => (
                                                            <PermTick key={s.id} id={s.id} label={s.label} kind="special" note={`on ${s.page}`}
                                                                selected={selected} original={original} describe={describe} onTogglePerm={onTogglePerm} />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-[11px] text-muted-foreground">Tick a page above to see its special actions.</p>
                                                )}
                                            </Lane>
                                        )}
                                        {hasSee && (
                                            <Lane kind="see">
                                                {showSee ? (
                                                    <PermTick id={modToggle!.id} label={modToggle!.label} kind="see"
                                                        selected={selected} original={original} describe={describe} onTogglePerm={onTogglePerm} />
                                                ) : (
                                                    <p className="text-[11px] text-muted-foreground">Tick a page above first.</p>
                                                )}
                                            </Lane>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

// Cross-section permissions — toggles that affect behaviour OUTSIDE their native
// module (e.g. Contacts → show suppliers also filters voucher party dropdowns).
// Rendered as a standalone card so the admin sees them at a glance, not buried
// inside the Sidebar links section.
export function GlobalPermissionsSection({
    selected,
    original,
    inLens,
    describe,
    onTogglePerm,
}: {
    selected: Set<string>;
    original: Set<string>;
    inLens: (id: string) => boolean;
    describe: (id: string) => string | undefined;
    onTogglePerm: (id: string) => void;
}) {
    // Collect every MODULE_EXTRA_TOGGLE entry marked global.
    const globalToggles = Object.values(MODULE_EXTRA_TOGGLE).filter((t) => t.global);

    // Show if the permission itself passes the department lens (pool-exempt permissions
    // like customers:view:creditors are always visible, regardless of trigger links).
    const visible = globalToggles.filter((t) => inLens(t.id));

    if (visible.length === 0) return null;

    return (
        <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <Globe size={15} className="text-amber-700 dark:text-amber-400" /> Sign-in &amp; what they can see everywhere
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Not tied to one page: these decide where they can sign in, and which data shows across many screens. Hover a tick to read what it allows.
                    </p>
                </div>
                <div className="space-y-2">
                    {visible.map((toggle) => (
                        <div key={toggle.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                            <PermTick id={toggle.id} label={toggle.label} kind="see"
                                selected={selected} original={original} describe={describe} onTogglePerm={onTogglePerm} />
                            {toggle.globalDescription && (
                                <p className="mt-1 min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">{toggle.globalDescription}</p>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
