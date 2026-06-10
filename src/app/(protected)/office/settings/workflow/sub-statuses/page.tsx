"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronRight, GitMerge, Lock, Pencil, Plus, Trash2 } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { COLOR_OPTIONS, WARRANTY_SCOPE_OPTIONS } from "@/utils/constants";

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
    workId?: string | null;
    order: number;
    applicableStatusIds: string[];
    triggerMap: Record<string, string>;
    actionLabel: string | null;
    warrantyScope?: string;
    autoRevertOnClear: boolean;
    isEntryPoint: boolean;
    fromTransitions: { to: { id: string; label: string; color: string } }[];
}

interface Work {
    id: string;
    label: string;
    color: string;
    order: number;
    permissionId: string | null;
}

type FormValues = {
    label: string;
    color: string;
    workId: string;
    order: string;
    applicableStatusIds: string[];
    triggerMap: Record<string, string>;
    actionLabel: string;
    warrantyScope: string;
    autoRevertOnClear: boolean;
    isEntryPoint: boolean;
};

const BLANK_FORM: FormValues = {
    label: "",
    color: "bg-gray-100 text-gray-600",
    workId: "",
    order: "",
    applicableStatusIds: [],
    triggerMap: {},
    actionLabel: "",
    warrantyScope: "any",
    autoRevertOnClear: true,
    isEntryPoint: true,
};

function SubStatusFormModal({
    open,
    title,
    form,
    setForm,
    onSave,
    onClose,
    saving,
    statuses,
    works,
}: {
    open: boolean;
    title: string;
    form: FormValues;
    setForm: (form: FormValues) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
    statuses: StatusItem[];
    works: Work[];
}) {
    const toggleApplicable = (value: string) =>
        setForm({
            ...form,
            applicableStatusIds: form.applicableStatusIds.includes(value)
                ? form.applicableStatusIds.filter((item) => item !== value)
                : [...form.applicableStatusIds, value],
        });

    const setTrigger = (statusId: string, targetId: string) => {
        const next = { ...form.triggerMap };
        if (targetId) next[statusId] = targetId;
        else delete next[statusId];
        setForm({ ...form, triggerMap: next });
    };

    const selectedWork = works.find((w) => w.id === form.workId);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Configure where this sub-status appears and which work it represents.
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Work</Label>
                            <Select value={form.workId || "__none__"} onValueChange={(value) => setForm({ ...form, workId: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select work" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {works.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>{w.label}{w.permissionId ? " (gated)" : ""}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {selectedWork?.permissionId
                                    ? `Only staff with the “${selectedWork.label}” work permission can set this.`
                                    : "Ungated work — any staff can set this sub-status."}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Warranty scope</Label>
                            <Select value={form.warrantyScope} onValueChange={(value) => setForm({ ...form, warrantyScope: value })}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WARRANTY_SCOPE_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Action label</Label>
                        <Input
                            value={form.actionLabel}
                            onChange={(e) => setForm({ ...form, actionLabel: e.target.value })}
                            placeholder="e.g. Call customer — quote ready for approval"
                        />
                        <p className="text-xs text-muted-foreground">
                            Shown on work dashboards as the task description.
                        </p>
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

                    <div className="space-y-3">
                        <Label>Applies to (main status)</Label>
                        {statuses.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Loading statuses…</p>
                        ) : (
                            <div className="space-y-2">
                                {statuses.map((status) => (
                                    <div key={status.id} className="rounded-md border border-border p-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm">
                                                <Checkbox
                                                    checked={form.applicableStatusIds.includes(status.id)}
                                                    onCheckedChange={() => toggleApplicable(status.id)}
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

                    <div className="space-y-2">
                        <Label>Order</Label>
                        <Input
                            type="text"
                            inputMode="numeric"
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
    const [works, setWorks] = useState<Work[]>([]);
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

    const worksById = Object.fromEntries(works.map((w) => [w.id, w]));

    const loadAll = async (pipelineId: string) => {
        setLoading(true);
        try {
            const [statusResponse, subStatusResponse, pipelineResponse, workResponse] = await Promise.all([
                axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
                axios.get(`/api/sub-statuses?pipelineId=${pipelineId}`),
                axios.get("/api/pipelines"),
                axios.get("/api/works"),
            ]);
            setStatuses((statusResponse.data as StatusItem[]).sort((a, b) => a.order - b.order));
            setSubStatuses(subStatusResponse.data);
            setPipelines(pipelineResponse.data);
            setWorks(workResponse.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(activePipelineId); }, [activePipelineId]);

    const subStatusPayload = (form: FormValues) => ({
        label: form.label,
        color: form.color,
        workId: form.workId || null,
        order: form.order ? Number(form.order) : undefined,
        applicableStatusIds: form.applicableStatusIds,
        triggerMap: form.triggerMap,
        actionLabel: form.actionLabel || null,
        warrantyScope: form.warrantyScope,
        autoRevertOnClear: form.autoRevertOnClear,
        isEntryPoint: form.isEntryPoint,
    });

    const handleCreate = async () => {
        setCreating(true);
        try {
            await axios.post("/api/sub-statuses", { ...subStatusPayload(createForm), pipelineId: activePipelineId });
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
            workId: subStatus.workId ?? "",
            order: String(subStatus.order),
            applicableStatusIds: subStatus.applicableStatusIds,
            triggerMap: (subStatus.triggerMap ?? {}) as Record<string, string>,
            actionLabel: subStatus.actionLabel ?? "",
            warrantyScope: subStatus.warrantyScope ?? "any",
            autoRevertOnClear: subStatus.autoRevertOnClear ?? true,
            isEntryPoint: subStatus.isEntryPoint ?? false,
        });
        setEditId(subStatus.id);
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            await axios.patch(`/api/sub-statuses/${editId}`, subStatusPayload(editForm));
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

    const byParent = statuses.map((status) => ({
        status,
        children: subStatuses
            .filter((subStatus) => subStatus.applicableStatusIds.includes(status.id))
            .sort((a, b) => a.order - b.order),
    })).filter((entry) => entry.children.length > 0);

    const unassigned = subStatuses.filter((subStatus) => subStatus.applicableStatusIds.length === 0);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="mx-auto max-w-5xl space-y-6 px-6 pt-3 pb-6">
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
                                {children.map((subStatus) => {
                                    const work = subStatus.workId ? worksById[subStatus.workId] : undefined;
                                    return (
                                    <div key={subStatus.id} className="flex items-start gap-3 border-b px-6 py-4 last:border-b-0">
                                        <Badge className={subStatus.color}>{subStatus.id}</Badge>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">{subStatus.label}</span>
                                                {work && (
                                                    <Badge className={work.color}>
                                                        {work.permissionId && <Lock size={10} className="mr-1" />}
                                                        {work.label}
                                                    </Badge>
                                                )}
                                                {subStatus.isEntryPoint && <Badge className="bg-green-100 text-green-700">Entry point</Badge>}
                                                {subStatus.triggerMap[status.id] && (
                                                    <Badge className="bg-orange-100 text-orange-700">
                                                        <ChevronRight size={11} />
                                                        {statusLabelMap[subStatus.triggerMap[status.id]] ?? subStatus.triggerMap[status.id]}
                                                    </Badge>
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
                                    );
                                })}
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

            {/* Sub-status modals */}
            <SubStatusFormModal
                open={showCreate}
                title="Add Sub-Status"
                form={createForm}
                setForm={setCreateForm}
                onSave={handleCreate}
                onClose={() => setShowCreate(false)}
                saving={creating}
                statuses={statuses}
                works={works}
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
                works={works}
            />

            {/* Transitions dialog */}
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
                                <label key={candidate.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
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
        </ScrollArea>
    );
}
