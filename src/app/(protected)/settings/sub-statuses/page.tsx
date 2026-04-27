"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronRight, GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Pipeline {
    id: string;
    label: string;
    color: string;
}

interface StatusItem {
    id: string;
    label: string;
    color: string;
    order: number;
}

interface SubStatus {
    id: string;
    label: string;
    color: string;
    group: string;
    order: number;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    triggerMap: Record<string, string>;
    actionLabel: string | null;
    handoffRole: string | null;
    autoRevertOnClear: boolean;
    isEntryPoint: boolean;
    fromTransitions: { to: { id: string; label: string; color: string } }[];
}

type FormValues = {
    label: string;
    color: string;
    group: string;
    order: string;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    triggerMap: Record<string, string>;
    actionLabel: string;
    warrantyScope: string;
    handoffRole: string;
    autoRevertOnClear: boolean;
    isEntryPoint: boolean;
};

const BLANK_FORM: FormValues = {
    label: "",
    color: "bg-gray-100 text-gray-600",
    group: "customer_comm",
    order: "",
    applicableStatusIds: [],
    allowedRoles: [],
    notifyRoles: [],
    triggerMap: {},
    actionLabel: "",
    warrantyScope: "any",
    handoffRole: "",
    autoRevertOnClear: true,
    isEntryPoint: true,
};

const GROUP_OPTIONS = [
    { value: "customer_comm", label: "Call Customer" },
    { value: "approval", label: "Quote & Approval" },
    { value: "parts", label: "Parts" },
    { value: "qc", label: "Quality Check" },
    { value: "escalated", label: "Escalated" },
    { value: "ready", label: "Ready for Collection" },
    { value: "no_fix", label: "No Fix" },
] as const;

const GROUP_LABELS = Object.fromEntries(GROUP_OPTIONS.map((group) => [group.value, group.label]));

const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600" },
    { label: "Blue", value: "bg-blue-100 text-blue-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-700" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Green", value: "bg-green-100 text-green-700" },
    { label: "Red", value: "bg-red-100 text-red-600" },
    { label: "Teal", value: "bg-teal-100 text-teal-600" },
] as const;

function SubStatusFormModal({
    open,
    title,
    form,
    setForm,
    onSave,
    onClose,
    saving,
    statuses,
    roles,
}: {
    open: boolean;
    title: string;
    form: FormValues;
    setForm: (form: FormValues) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
    statuses: StatusItem[];
    roles: { id: string; label: string }[];
}) {
    const toggle = (field: "applicableStatusIds" | "allowedRoles" | "notifyRoles", value: string) =>
        setForm({
            ...form,
            [field]: form[field].includes(value)
                ? form[field].filter((item) => item !== value)
                : [...form[field], value],
        });

    const setTrigger = (statusId: string, targetId: string) => {
        const next = { ...form.triggerMap };
        if (targetId) next[statusId] = targetId;
        else delete next[statusId];
        setForm({ ...form, triggerMap: next });
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Configure where this sub-status appears, who can use it, and how it hands off work.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="space-y-2">
                        <Label>Label</Label>
                        <Input
                            value={form.label}
                            onChange={(e) => setForm({ ...form, label: e.target.value })}
                            placeholder="e.g. Waiting for Parts"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Warranty scope</Label>
                        <Select value={form.warrantyScope} onValueChange={(value) => setForm({ ...form, warrantyScope: value })}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">Any (shown for all tickets)</SelectItem>
                                <SelectItem value="warranty_only">Warranty only</SelectItem>
                                <SelectItem value="non_warranty_only">Non-warranty only</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Action label</Label>
                        <Input
                            value={form.actionLabel}
                            onChange={(e) => setForm({ ...form, actionLabel: e.target.value })}
                            placeholder="e.g. Call customer — quote ready for approval"
                        />
                        <p className="text-xs text-muted-foreground">
                            Shown on role dashboards as the task description.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Handoff role</Label>
                            <Select value={form.handoffRole || "__none__"} onValueChange={(value) => setForm({ ...form, handoffRole: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {roles.map((role) => (
                                        <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Auto-assigns a secondary owner with this role when the sub-status is set.
                            </p>
                        </div>
                        <div className="space-y-3 pt-6">
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={form.autoRevertOnClear}
                                    onCheckedChange={(checked) => setForm({ ...form, autoRevertOnClear: checked === true })}
                                />
                                Auto-remove participant on clear
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={form.isEntryPoint}
                                    onCheckedChange={(checked) => setForm({ ...form, isEntryPoint: checked === true })}
                                />
                                Entry point
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <Select value={form.color} onValueChange={(value) => setForm({ ...form, color: value })}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((color) => (
                                        <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Badge className={form.color}>Preview</Badge>
                        </div>
                        <div className="space-y-2">
                            <Label>Group</Label>
                            <Select value={form.group} onValueChange={(value) => setForm({ ...form, group: value })}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {GROUP_OPTIONS.map((group) => (
                                        <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label>Applies to (main status)</Label>
                        {statuses.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Loading statuses…</p>
                        ) : (
                            <div className="space-y-2">
                                {statuses.map((status) => (
                                    <div key={status.id} className="border-2 border-border p-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm">
                                                <Checkbox
                                                    checked={form.applicableStatusIds.includes(status.id)}
                                                    onCheckedChange={() => toggle("applicableStatusIds", status.id)}
                                                />
                                                <Badge className={status.color}>{status.label}</Badge>
                                            </label>
                                            {form.applicableStatusIds.includes(status.id) && (
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <span>Auto-advance to</span>
                                                    <Select
                                                        value={form.triggerMap[status.id] ?? "__none__"}
                                                        onValueChange={(value) => setTrigger(status.id, value === "__none__" ? "" : value)}
                                                    >
                                                        <SelectTrigger className="w-48">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__none__">— none —</SelectItem>
                                                            {statuses.filter((candidate) => candidate.id !== status.id).map((candidate) => (
                                                                <SelectItem key={candidate.id} value={candidate.id}>{candidate.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Who can set it</Label>
                            <div className="space-y-2">
                                {roles.map((role) => (
                                    <label key={role.id} className="flex items-center gap-2 border-2 border-border px-3 py-2 text-sm">
                                        <Checkbox
                                            checked={form.allowedRoles.includes(role.id)}
                                            onCheckedChange={() => toggle("allowedRoles", role.id)}
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Notifies</Label>
                            <div className="space-y-2">
                                {roles.map((role) => (
                                    <label key={role.id} className="flex items-center gap-2 border-2 border-border px-3 py-2 text-sm">
                                        <Checkbox
                                            checked={form.notifyRoles.includes(role.id)}
                                            onCheckedChange={() => toggle("notifyRoles", role.id)}
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Order</Label>
                        <Input
                            type="number"
                            value={form.order}
                            onChange={(e) => setForm({ ...form, order: e.target.value })}
                            placeholder="Auto-assigned if blank"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={onSave} disabled={saving || !form.label.trim()}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function SubStatusesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string>("P1");
    const [statuses, setStatuses] = useState<StatusItem[]>([]);
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [roles, setRoles] = useState<{ id: string; label: string }[]>([]);
    const [loading, setLoading] = useState(true);

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState<FormValues>(BLANK_FORM);
    const [creating, setCreating] = useState(false);

    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<FormValues>(BLANK_FORM);
    const [editing, setEditing] = useState(false);

    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    const loadAll = async (pipelineId: string) => {
        setLoading(true);
        try {
            const [statusResponse, subStatusResponse, roleResponse, pipelineResponse] = await Promise.all([
                axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
                axios.get(`/api/sub-statuses?pipelineId=${pipelineId}`),
                axios.get("/api/roles"),
                axios.get("/api/pipelines"),
            ]);
            setStatuses((statusResponse.data as StatusItem[]).sort((a, b) => a.order - b.order));
            setSubStatuses(subStatusResponse.data);
            setRoles(roleResponse.data);
            setPipelines(pipelineResponse.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(activePipelineId); }, [activePipelineId]);

    const handleCreate = async () => {
        setCreating(true);
        try {
            await axios.post("/api/sub-statuses", {
                ...createForm,
                order: createForm.order ? Number(createForm.order) : undefined,
                handoffRole: createForm.handoffRole || null,
                pipelineId: activePipelineId,
                isEntryPoint: createForm.isEntryPoint,
            });
            toast.success("Sub-status created");
            setShowCreate(false);
            setCreateForm(BLANK_FORM);
            loadAll(activePipelineId);
        } catch {
            toast.error("Failed to create");
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (subStatus: SubStatus) => {
        setEditForm({
            label: subStatus.label,
            color: subStatus.color,
            group: subStatus.group,
            order: String(subStatus.order),
            applicableStatusIds: subStatus.applicableStatusIds,
            allowedRoles: subStatus.allowedRoles,
            notifyRoles: subStatus.notifyRoles,
            triggerMap: (subStatus.triggerMap ?? {}) as Record<string, string>,
            actionLabel: subStatus.actionLabel ?? "",
            warrantyScope: (subStatus as SubStatus & { warrantyScope?: string }).warrantyScope ?? "any",
            handoffRole: subStatus.handoffRole ?? "",
            autoRevertOnClear: subStatus.autoRevertOnClear ?? true,
            isEntryPoint: subStatus.isEntryPoint ?? false,
        });
        setEditId(subStatus.id);
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            await axios.patch(`/api/sub-statuses/${editId}`, {
                label: editForm.label,
                color: editForm.color,
                group: editForm.group,
                order: editForm.order ? Number(editForm.order) : undefined,
                applicableStatusIds: editForm.applicableStatusIds,
                allowedRoles: editForm.allowedRoles,
                notifyRoles: editForm.notifyRoles,
                triggerMap: editForm.triggerMap,
                actionLabel: editForm.actionLabel || null,
                warrantyScope: editForm.warrantyScope,
                handoffRole: editForm.handoffRole || null,
                autoRevertOnClear: editForm.autoRevertOnClear,
                isEntryPoint: editForm.isEntryPoint,
            });
            toast.success("Sub-status updated");
            setEditId(null);
            loadAll(activePipelineId);
        } catch {
            toast.error("Failed to update");
        } finally {
            setEditing(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await axios.delete(`/api/sub-statuses/${id}`);
            toast.success("Sub-status deleted");
            loadAll(activePipelineId);
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to delete";
            toast.error(message ?? "Failed to delete");
        } finally {
            setDeletingId(null);
        }
    };

    const openTransitionModal = (id: string) => {
        const subStatus = subStatuses.find((item) => item.id === id);
        setSelectedToIds(subStatus?.fromTransitions.map((transition) => transition.to.id) ?? []);
        setTransitionModalId(id);
    };

    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/sub-statuses/${transitionModalId}/transitions`, { toIds: selectedToIds });
            toast.success("Transitions saved");
            setTransitionModalId(null);
            loadAll(activePipelineId);
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const toggleTo = (id: string) =>
        setSelectedToIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);

    const modalSubStatus = subStatuses.find((subStatus) => subStatus.id === transitionModalId);
    const transitionCandidates = modalSubStatus
        ? subStatuses.filter((subStatus) =>
            subStatus.id !== modalSubStatus.id &&
            subStatus.applicableStatusIds.some((statusId) => modalSubStatus.applicableStatusIds.includes(statusId))
        )
        : [];

    const statusLabelMap = Object.fromEntries(statuses.map((status) => [status.id, status.label]));
    const roleLabelMap = Object.fromEntries(roles.map((role) => [role.id, role.label]));

    const byParent = statuses.map((status) => ({
        status,
        children: subStatuses
            .filter((subStatus) => subStatus.applicableStatusIds.includes(status.id))
            .sort((a, b) => a.order - b.order),
    })).filter((entry) => entry.children.length > 0);

    const unassigned = subStatuses.filter((subStatus) => subStatus.applicableStatusIds.length === 0);

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Sub-Statuses</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Organised by main status, showing which sub-statuses apply at each stage.
                    </p>
                </div>
                <Button type="button" onClick={() => { setCreateForm(BLANK_FORM); setShowCreate(true); }}>
                    <Plus size={16} /> Add Sub-Status
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                {pipelines.map((pipeline) => (
                    <Button
                        key={pipeline.id}
                        type="button"
                        size="sm"
                        variant={activePipelineId === pipeline.id ? "default" : "outline"}
                        onClick={() => { setActivePipelineId(pipeline.id); setShowCreate(false); setEditId(null); }}
                    >
                        {pipeline.label}
                    </Button>
                ))}
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="space-y-5">
                    {byParent.map(({ status, children }) => (
                        <Card key={status.id}>
                            <CardHeader className="border-b">
                                <div className="flex items-center gap-3">
                                    <Badge className={status.color}>{status.id}</Badge>
                                    <CardTitle>{status.label}</CardTitle>
                                    <CardDescription className="ml-auto">
                                        {children.length} sub-status{children.length !== 1 ? "es" : ""}
                                    </CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-0 px-0 pt-0">
                                {children.map((subStatus) => (
                                    <div key={subStatus.id} className="flex items-start gap-3 border-b px-6 py-4 last:border-b-0">
                                        <Badge className={subStatus.color}>{subStatus.id}</Badge>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">{subStatus.label}</span>
                                                <Badge variant="outline">{GROUP_LABELS[subStatus.group] ?? subStatus.group}</Badge>
                                                {subStatus.isEntryPoint && <Badge className="bg-green-100 text-green-700">Entry point</Badge>}
                                                {subStatus.triggerMap[status.id] && (
                                                    <Badge className="bg-orange-100 text-orange-700">
                                                        <ChevronRight size={11} />
                                                        {statusLabelMap[subStatus.triggerMap[status.id]] ?? subStatus.triggerMap[status.id]}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                {subStatus.allowedRoles.length > 0 && (
                                                    <span>
                                                        <span className="font-medium text-foreground">Set by:</span>{" "}
                                                        {subStatus.allowedRoles.map((roleId) => roleLabelMap[roleId] ?? roleId).join(", ")}
                                                    </span>
                                                )}
                                                {subStatus.notifyRoles.length > 0 && (
                                                    <span>
                                                        <span className="font-medium text-foreground">Notifies:</span>{" "}
                                                        {subStatus.notifyRoles.map((roleId) => roleLabelMap[roleId] ?? roleId).join(", ")}
                                                    </span>
                                                )}
                                            </div>

                                            {subStatus.fromTransitions.length > 0 && (
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    <span className="text-xs text-muted-foreground">Next:</span>
                                                    {subStatus.fromTransitions.map((transition) => (
                                                        <Badge key={transition.to.id} className={transition.to.color}>
                                                            {transition.to.label}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            <Button type="button" size="sm" variant="outline" onClick={() => openTransitionModal(subStatus.id)}>
                                                <GitMerge size={13} /> Flow
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(subStatus)}>
                                                <Pencil size={13} /> Edit
                                            </Button>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="destructive"
                                                onClick={() => handleDelete(subStatus.id)}
                                                disabled={deletingId === subStatus.id}
                                            >
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}

                    {unassigned.length > 0 && (
                        <Card>
                            <CardHeader className="border-b">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-yellow-100 text-yellow-700">Unassigned</Badge>
                                    <CardDescription>Not linked to any main status yet.</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-0 px-0 pt-0">
                                {unassigned.map((subStatus) => (
                                    <div key={subStatus.id} className="flex items-center gap-3 border-b px-6 py-4 last:border-b-0">
                                        <Badge className={subStatus.color}>{subStatus.id}</Badge>
                                        <span className="flex-1 text-sm">{subStatus.label}</span>
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(subStatus)}>
                                                <Pencil size={13} /> Edit
                                            </Button>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="destructive"
                                                onClick={() => handleDelete(subStatus.id)}
                                                disabled={deletingId === subStatus.id}
                                            >
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            <SubStatusFormModal
                open={showCreate}
                title="Add Sub-Status"
                form={createForm}
                setForm={setCreateForm}
                onSave={handleCreate}
                onClose={() => setShowCreate(false)}
                saving={creating}
                statuses={statuses}
                roles={roles}
            />

            <SubStatusFormModal
                open={!!editId}
                title={`Edit — ${subStatuses.find((subStatus) => subStatus.id === editId)?.id ?? ""}`}
                form={editForm}
                setForm={setEditForm}
                onSave={handleEdit}
                onClose={() => setEditId(null)}
                saving={editing}
                statuses={statuses}
                roles={roles}
            />

            <Dialog open={!!transitionModalId && !!modalSubStatus} onOpenChange={(isOpen) => { if (!isOpen) setTransitionModalId(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Step Flow</DialogTitle>
                        <DialogDescription>
                            {modalSubStatus ? `Choose which sub-statuses can come after ${modalSubStatus.label}.` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-72 space-y-2 overflow-y-auto">
                        {transitionCandidates.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No compatible sub-statuses in the same stage.</p>
                        ) : (
                            transitionCandidates.map((candidate) => (
                                <label key={candidate.id} className="flex items-center gap-3 border-2 border-border px-3 py-2">
                                    <Checkbox checked={selectedToIds.includes(candidate.id)} onCheckedChange={() => toggleTo(candidate.id)} />
                                    <Badge className={candidate.color}>{candidate.id}</Badge>
                                    <span className="text-sm">{candidate.label}</span>
                                </label>
                            ))
                        )}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setTransitionModalId(null)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={saveTransitions} disabled={savingTransitions}>
                            {savingTransitions ? "Saving..." : "Save Flow"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
