"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Trash2, Save, ArrowUpDown, GitMerge, Briefcase, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
import { WARRANTY_SCOPE_OPTIONS } from "@/shared/lib/constants/badges";
import { ColorPicker, randomColor } from "@/shared/components/ColorPicker";
import { badgeColor } from "@/shared/lib/format/entityColor";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { MessageTemplatePicker } from "@/modules/settings/components/MessageTemplatePicker";

interface Pipeline {
    id: string;
    label: string;
    color: string;
}

interface Work {
    id: string;
    label: string;
    color: string;
    order: number;
    permissionId: string | null;
}

interface WorkGroup {
    id: string;
    label: string;
    color: string;
}

interface TicketStatus {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
    isEntryPoint: boolean;
    workId?: string | null;
    actionLabel: string | null;
    warrantyScope: string;
    leavePrompt: string | null;
    announceOnEntry: boolean;
    etaText: string | null;
    waTemplate: string | null;
    emailTemplate: string | null;
    resolveTimeHours: number | null;
    resolveGroupId?: string | null;
    autoMoveAfterDays: number | null;
    autoMoveToId: string | null;
    pipelineId: string | null;
    fromTransitions: { toStatusId: string; to: { label: string } }[];
    _count: { tickets: number };
}

interface StatusForm {
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
    isEntryPoint: boolean;
    workId: string;
    warrantyScope: string;
    actionLabel: string;
    leavePrompt: string;
    announceOnEntry: boolean;
    etaText: string;
    waTemplate: string;
    emailTemplate: string;
    // Resolve time entered as days + hours (UI convenience) — combined into total
    // hours only when saving. resolveTimeHoursPart is the 0–23 remainder.
    resolveTimeDays: string;
    resolveTimeHoursPart: string;
    resolveGroupId: string;
    // Roles that see this status' overdue notices. Empty = everyone.
    overdueRoleIds: string[];
    overdueRolesDirty: boolean;
    autoMoveAfterDays: string;
    autoMoveToId: string;
}

// "76" → "3d 4h" (drops the zero side: "3d" or "4h" alone) — for the read-only SLA badge.
function formatResolveTime(totalHours: number): string {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days === 0) return `${hours}h`;
    if (hours === 0) return `${days}d`;
    return `${days}d ${hours}h`;
}

const EMPTY_FORM: StatusForm = {
    label: "", color: "bg-gray-100 text-gray-600", order: 0, isTerminal: false, isEntryPoint: false,
    workId: "", warrantyScope: "any", actionLabel: "", leavePrompt: "", announceOnEntry: false, etaText: "", waTemplate: "", emailTemplate: "",
    resolveTimeDays: "", resolveTimeHoursPart: "", resolveGroupId: "", overdueRoleIds: [], overdueRolesDirty: false, autoMoveAfterDays: "", autoMoveToId: "",
};

interface RoleOption { id: string; label: string; isAdmin: boolean; permissionIds: string[] }

export default function StatusesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string>("P1");
    const [statuses, setStatuses] = useState<TicketStatus[]>([]);
    const [works, setWorks] = useState<Work[]>([]);
    const [groups, setGroups] = useState<WorkGroup[]>([]);
    const [roles, setRoles] = useState<RoleOption[]>([]);
    const [loading, setLoading] = useState(true);

    // One full "Edit status" dialog covers basics, flags, work (optional), and prompts.
    const [editModalId, setEditModalId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<StatusForm>(EMPTY_FORM);
    const [savingEdit, setSavingEdit] = useState(false);

    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    const [addingNew, setAddingNew] = useState(false);
    const [newStatus, setNewStatus] = useState({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });

    const worksById = Object.fromEntries(works.map((w) => [w.id, w]));

    // `silent` refetches keep the current list on screen — used after a save,
    // where blanking the list to a spinner reads as a page blink. The spinner
    // still shows on first load and when switching pipeline.
    const readData = (pipelineId: string) => Promise.all([
        axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
        axios.get("/api/works"),
        axios.get("/api/pipelines"),
        axios.get("/api/work-groups"),
        axios.get<{ id: string; label: string; department?: { isAllAccess: boolean } | null; permissions: { permissionId: string }[] }[]>("/api/roles"),
    ])
        .then(([statusesResponse, worksResponse, pipelinesResponse, groupsResponse, rolesResponse]) => {
            setRoles(rolesResponse.data.map((r) => ({ id: r.id, label: r.label, isAdmin: r.id === "R1" || !!r.department?.isAllAccess, permissionIds: r.permissions.map((p) => p.permissionId) })));
            setStatuses(statusesResponse.data);
            setWorks(worksResponse.data);
            setPipelines(pipelinesResponse.data);
            setGroups(groupsResponse.data);
        })
        .catch(() => { toast.error("Failed to load data"); })
        .finally(() => setLoading(false));
    const fetchData = (pipelineId: string, opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        return readData(pipelineId);
    };

    // First load / another pipeline: the spinner is on from the first render
    // (it starts true), so the effect only reads.
    if (useValueChange(activePipelineId)) setLoading(true);
    useEffect(() => { void readData(activePipelineId); }, [activePipelineId]);

    // Silent so the list does not blink: a status edited elsewhere announces
    // `tickets` and this pipeline's rows are re-read in place.
    useRealtimeTopics(["tickets"], () => { fetchData(activePipelineId, { silent: true }); });

    const switchPipeline = (id: string) => {
        setActivePipelineId(id);
        setEditModalId(null);
        setAddingNew(false);
    };

    const openEdit = (status: TicketStatus) => {
        setEditModalId(status.id);
        setEditForm({
            label: status.label,
            color: status.color,
            order: status.order,
            isTerminal: status.isTerminal,
            isEntryPoint: status.isEntryPoint,
            workId: status.workId ?? "",
            warrantyScope: status.warrantyScope ?? "any",
            actionLabel: status.actionLabel ?? "",
            leavePrompt: status.leavePrompt ?? "",
            announceOnEntry: status.announceOnEntry ?? false,
            etaText: status.etaText ?? "",
            waTemplate: status.waTemplate ?? "",
            emailTemplate: status.emailTemplate ?? "",
            resolveTimeDays: status.resolveTimeHours != null ? String(Math.floor(status.resolveTimeHours / 24)) : "",
            resolveTimeHoursPart: status.resolveTimeHours != null ? String(status.resolveTimeHours % 24) : "",
            resolveGroupId: status.resolveGroupId ?? "",
            overdueRoleIds: roles.filter((r) => !r.isAdmin && r.permissionIds.includes(`status-overdue:${status.id}`)).map((r) => r.id),
            overdueRolesDirty: false,
            autoMoveAfterDays: status.autoMoveAfterDays != null ? String(status.autoMoveAfterDays) : "",
            autoMoveToId: status.autoMoveToId ?? "",
        });
    };

    const saveEdit = async () => {
        if (!editModalId) return;
        if (!editForm.label.trim()) {
            toast.error("Label is required");
            return;
        }
        // Auto-move needs both halves, or neither.
        const autoDays = editForm.autoMoveAfterDays.trim() === "" ? null : Math.min(365, Math.max(1, Number(editForm.autoMoveAfterDays)));
        const autoTo = editForm.autoMoveToId || null;
        if ((autoDays == null) !== (autoTo == null)) {
            toast.error("Auto-move needs both the days and the status to move to");
            return;
        }
        setSavingEdit(true);
        try {
            const daysBlank = editForm.resolveTimeDays.trim() === "";
            const hoursBlank = editForm.resolveTimeHoursPart.trim() === "";
            const resolveTimeHours = daysBlank && hoursBlank
                ? null
                : (daysBlank ? 0 : Number(editForm.resolveTimeDays)) * 24 + (hoursBlank ? 0 : Number(editForm.resolveTimeHoursPart));
            await axios.patch(`/api/ticket-statuses/${editModalId}`, {
                label: editForm.label.trim(),
                color: editForm.color,
                order: Number(editForm.order),
                isTerminal: editForm.isTerminal,
                isEntryPoint: editForm.isEntryPoint,
                workId: editForm.workId || null,
                warrantyScope: editForm.warrantyScope,
                actionLabel: editForm.actionLabel.trim() || null,
                leavePrompt: editForm.leavePrompt.trim() || null,
                announceOnEntry: editForm.announceOnEntry,
                etaText: editForm.etaText.trim() || null,
                waTemplate: editForm.waTemplate || null,
                emailTemplate: editForm.emailTemplate || null,
                resolveTimeHours,
                resolveGroupId: editForm.resolveGroupId || null,
                // None ticked → [] → everyone sees them. Otherwise admin roles ride along.
                ...(editForm.overdueRolesDirty && {
                    overdueRoleIds: editForm.overdueRoleIds.length
                        ? [...new Set([...editForm.overdueRoleIds, ...roles.filter((r) => r.isAdmin).map((r) => r.id)])]
                        : [],
                }),
                autoMoveAfterDays: autoDays,
                autoMoveToId: autoTo,
            });
            toast.success("Status updated");
            setEditModalId(null);
            await fetchData(activePipelineId, { silent: true });
        } catch {
            toast.error("Failed to update status");
        } finally {
            setSavingEdit(false);
        }
    };

    const deleteStatus = async (id: string, ticketCount: number) => {
        if (ticketCount > 0) {
            toast.error(`Cannot delete: ${ticketCount} ticket(s) use this status.`);
            return;
        }

        if (!(await confirmAction({ title: "Delete this status?", body: "This cannot be undone.", confirmLabel: "Delete" }))) return;

        try {
            await axios.delete(`/api/ticket-statuses/${id}`);
            toast.success("Status deleted");
            await fetchData(activePipelineId, { silent: true });
        } catch (err: unknown) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(message ?? "Failed to delete status");
        }
    };

    const openTransitions = (status: TicketStatus) => {
        setTransitionModalId(status.id);
        setSelectedToIds(status.fromTransitions.map((transition) => transition.toStatusId));
    };

    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/ticket-statuses/${transitionModalId}/transitions`, { toIds: selectedToIds });
            toast.success("Transitions saved");
            setTransitionModalId(null);
            await fetchData(activePipelineId, { silent: true });
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const addStatus = async () => {
        if (!newStatus.label.trim()) {
            toast.error("Label is required");
            return;
        }

        try {
            await axios.post("/api/ticket-statuses", {
                label: newStatus.label.trim(),
                color: newStatus.color,
                isTerminal: newStatus.isTerminal,
                order: statuses.length + 1,
                pipelineId: activePipelineId,
            });
            toast.success("Status added");
            setAddingNew(false);
            setNewStatus({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });
            await fetchData(activePipelineId, { silent: true });
        } catch {
            toast.error("Failed to create status");
        }
    };

    const transitionStatus = transitionModalId ? statuses.find((status) => status.id === transitionModalId) : null;
    const editStatus = editModalId ? statuses.find((status) => status.id === editModalId) : null;
    const activePipeline = pipelines.find((pipeline) => pipeline.id === activePipelineId);
    const selectedWork = editForm.workId ? worksById[editForm.workId] : undefined;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Ticket Statuses</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage status labels, colors, transitions, and the work each stage represents.
                    </p>
                </div>
                <Button type="button" onClick={() => { setNewStatus({ label: "", color: randomColor(), isTerminal: false }); setAddingNew(true); }}>
                    <Plus size={16} /> Add Status
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                {pipelines.map((pipeline) => (
                    <Button
                        key={pipeline.id}
                        type="button"
                        size="sm"
                        variant={activePipelineId === pipeline.id ? "default" : "outline"}
                        onClick={() => switchPipeline(pipeline.id)}
                    >
                        <span className={`h-2 w-2 ${pipeline.color.replace("text-", "bg-").split(" ")[1] ?? "bg-muted"}`} />
                        {pipeline.label}
                    </Button>
                ))}
            </div>

            <Card>
                {activePipeline && (
                    <CardHeader className="border-b">
                        <div className="flex items-center gap-2">
                            <Badge className={activePipeline.color}>{activePipeline.label}</Badge>
                            <CardDescription>
                                {statuses.length} stage{statuses.length !== 1 ? "s" : ""} in this pipeline
                            </CardDescription>
                        </div>
                    </CardHeader>
                )}
                <CardContent className="pt-4">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-20">ID</TableHead>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Color</TableHead>
                                    <TableHead className="w-24">
                                        <span className="flex items-center gap-1"><ArrowUpDown size={12} /> Order</span>
                                    </TableHead>
                                    <TableHead>Flags</TableHead>
                                    <TableHead>Resolve Time</TableHead>
                                    <TableHead>Work</TableHead>
                                    <TableHead>Transitions To</TableHead>
                                    <TableHead>Tickets</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {statuses.length === 0 && !addingNew && (
                                    <TableRow>
                                        <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                                            No statuses in this pipeline yet. Add the first one.
                                        </TableCell>
                                    </TableRow>
                                )}

                                {statuses.map((status) => (
                                    <TableRow key={status.id}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{status.id}</TableCell>
                                        <TableCell>
                                            <Badge {...badgeColor(status.color)}>{status.label}</Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{status.color}</TableCell>
                                        <TableCell>{status.order}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {status.isTerminal && <Badge className="bg-red-100 text-red-700">Terminal</Badge>}
                                                {status.isEntryPoint && <Badge className="bg-indigo-100 text-indigo-700">Entry Point</Badge>}
                                                {status.leavePrompt && <Badge className="bg-amber-100 text-amber-700">Leave prompt</Badge>}
                                                {status.announceOnEntry && <Badge className="bg-sky-100 text-sky-700">Announce</Badge>}
                                                {!status.isTerminal && !status.isEntryPoint && !status.leavePrompt && !status.announceOnEntry && (
                                                    <span className="text-xs text-muted-foreground">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {status.resolveTimeHours != null ? (
                                                <Badge className="bg-orange-100 text-orange-700">{formatResolveTime(status.resolveTimeHours)}</Badge>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {(() => {
                                                const work = status.workId ? worksById[status.workId] : undefined;
                                                return work ? (
                                                    <Badge className={work.color}>
                                                        {work.permissionId && <Lock size={10} className="mr-1" />}
                                                        {work.label}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">None</span>
                                                );
                                            })()}
                                        </TableCell>
                                        <TableCell>
                                            {status.fromTransitions.length === 0 ? (
                                                <span className="text-xs text-muted-foreground">None</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {status.fromTransitions.map((transition) => (
                                                        <Badge key={transition.toStatusId} variant="secondary">
                                                            {transition.to.label}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>{status._count.tickets}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-2">
                                                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(status)}>
                                                    <Briefcase size={12} /> Edit
                                                </Button>
                                                <Button type="button" size="sm" variant="outline" onClick={() => openTransitions(status)}>
                                                    <GitMerge size={12} /> Transitions
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="icon-sm"
                                                    variant="destructive"
                                                    onClick={() => deleteStatus(status.id, status._count.tickets)}
                                                    disabled={status._count.tickets > 0}
                                                    title={status._count.tickets > 0 ? `${status._count.tickets} tickets use this status` : "Delete"}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}

                                {addingNew && (
                                    <TableRow>
                                        <TableCell className="font-mono text-xs text-muted-foreground">auto</TableCell>
                                        <TableCell>
                                            <Input
                                                autoFocus
                                                value={newStatus.label}
                                                onChange={(e) => setNewStatus((prev) => ({ ...prev, label: e.target.value }))}
                                                placeholder="Label"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <ColorPicker value={newStatus.color} onChange={(c) => setNewStatus((prev) => ({ ...prev, color: c }))} />
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">auto</TableCell>
                                        <TableCell>
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Checkbox
                                                    checked={newStatus.isTerminal}
                                                    onCheckedChange={(checked) => setNewStatus((prev) => ({ ...prev, isTerminal: checked === true }))}
                                                />
                                                Terminal
                                            </label>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                                        <TableCell colSpan={2} className="text-xs text-muted-foreground">
                                            Set work after creation
                                        </TableCell>
                                        <TableCell>0</TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                <Button type="button" size="sm" onClick={addStatus}>
                                                    <Save size={12} /> Add
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setAddingNew(false);
                                                        setNewStatus({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!transitionModalId && !!transitionStatus} onOpenChange={(isOpen) => { if (!isOpen) setTransitionModalId(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Transitions</DialogTitle>
                        <DialogDescription>
                            {transitionStatus ? `Select which statuses ${transitionStatus.label} can move to.` : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                        {statuses
                            .filter((status) => status.id !== transitionModalId)
                            .map((status) => (
                                <label key={status.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                                    <Checkbox
                                        checked={selectedToIds.includes(status.id)}
                                        onCheckedChange={(checked) => {
                                            setSelectedToIds((prev) =>
                                                checked === true ? [...prev, status.id] : prev.filter((id) => id !== status.id)
                                            );
                                        }}
                                    />
                                    <Badge className={status.color}>{status.label}</Badge>
                                    <span className="text-xs font-mono text-muted-foreground">{status.id}</span>
                                </label>
                            ))}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setTransitionModalId(null)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={saveTransitions} disabled={savingTransitions}>
                            {savingTransitions ? "Saving…" : "Save Transitions"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editModalId && !!editStatus} onOpenChange={(isOpen) => { if (!isOpen) setEditModalId(null); }}>
                <DialogContent className="sm:max-w-5xl max-h-[96vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit status</DialogTitle>
                        <DialogDescription className="sr-only">
                            {editStatus ? `Configure “${editStatus.label}” (${editStatus.id}) — basics, flags, work, and crossing prompts.` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3 md:grid-cols-2 md:items-start">
                        <div className="space-y-3">
                        {/* ── Basics ─────────────────────────────────────── */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Label</Label>
                                <Input
                                    autoFocus
                                    value={editForm.label}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, label: e.target.value }))}
                                    placeholder="e.g. Diagnosing"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Order</Label>
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    value={editForm.order}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, order: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Color</Label>
                            <ColorPicker value={editForm.color} onChange={(c) => setEditForm((prev) => ({ ...prev, color: c }))} />
                        </div>

                        {/* ── Flags ──────────────────────────────────────── */}
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Flags</p>
                            <div className="flex flex-wrap gap-6 pt-1">
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={editForm.isEntryPoint}
                                        onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, isEntryPoint: checked === true }))}
                                    />
                                    Entry point
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={editForm.isTerminal}
                                        onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, isTerminal: checked === true }))}
                                    />
                                    Terminal
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Entry = new tickets land here. Terminal = close-out, no further moves.
                            </p>
                        </div>

                        {/* ── Resolve time (SLA) ─────────────────────────── */}
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolve time</p>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    className="w-20"
                                    value={editForm.resolveTimeDays}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, resolveTimeDays: e.target.value.replace(/[^0-9]/g, "") }))}
                                    placeholder="—"
                                />
                                <span className="text-sm text-muted-foreground">days</span>
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    className="w-20"
                                    value={editForm.resolveTimeHoursPart}
                                    onChange={(e) => {
                                        const digits = e.target.value.replace(/[^0-9]/g, "");
                                        const clamped = digits === "" ? "" : String(Math.min(23, Number(digits)));
                                        setEditForm((prev) => ({ ...prev, resolveTimeHoursPart: clamped }));
                                    }}
                                    placeholder="—"
                                />
                                <span className="text-sm text-muted-foreground">hours</span>
                                {/* No time limit = both boxes empty. Ticking clears them; typing a number unticks it. */}
                                <label className="ml-2 flex items-center gap-1.5 text-sm">
                                    <Checkbox
                                        checked={editForm.resolveTimeDays.trim() === "" && editForm.resolveTimeHoursPart.trim() === ""}
                                        onCheckedChange={(c) => setEditForm((prev) => c === true
                                            ? { ...prev, resolveTimeDays: "", resolveTimeHoursPart: "" }
                                            : { ...prev, resolveTimeDays: "0", resolveTimeHoursPart: "0" })}
                                    />
                                    No time limit
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Longer than this = <span className="font-medium text-foreground">Needs attention</span>. 0 days 0 hours = at once. No time limit = never overdue.
                            </p>
                            <div className="space-y-2 pt-1">
                                <Label>Group <span className="font-normal text-muted-foreground">(optional)</span></Label>
                                <Select value={editForm.resolveGroupId || "__none__"} onValueChange={(value) => setEditForm((prev) => ({ ...prev, resolveGroupId: value === "__none__" ? "" : value }))}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select group" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">— none —</SelectItem>
                                        {groups.map((g) => (
                                            <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Where an overdue ticket with no work shows. Blank = none.
                                </p>
                            </div>
                            {roles.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                    <Label>Who sees overdue tickets</Label>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                        {roles.map((r) => (
                                            <label key={r.id} className="flex items-center gap-1.5 text-xs">
                                                <Checkbox
                                                    checked={r.isAdmin || editForm.overdueRoleIds.includes(r.id)}
                                                    disabled={r.isAdmin}
                                                    onCheckedChange={(c) => setEditForm((prev) => ({
                                                        ...prev,
                                                        overdueRolesDirty: true,
                                                        overdueRoleIds: c === true ? [...prev.overdueRoleIds, r.id] : prev.overdueRoleIds.filter((id) => id !== r.id),
                                                    }))}
                                                />
                                                {r.label}
                                            </label>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">None ticked = everyone. Admin always sees them. Applies on the person&apos;s next login.</p>
                                </div>
                            )}
                        </div>

                        {/* ── Auto-move ──────────────────────────────────── */}
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auto-move</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-muted-foreground">After</span>
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    className="w-20"
                                    value={editForm.autoMoveAfterDays}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, autoMoveAfterDays: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) }))}
                                    placeholder="—"
                                />
                                <span className="text-sm text-muted-foreground">days, move to</span>
                                <Select value={editForm.autoMoveToId || "__none__"} onValueChange={(value) => setEditForm((prev) => ({ ...prev, autoMoveToId: value === "__none__" ? "" : value }))}>
                                    <SelectTrigger className="w-44">
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">— never —</SelectItem>
                                        {statuses.filter((s) => s.id !== editModalId).map((s) => (
                                            <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Moves by itself, no one clicks (e.g. Resolved → Closed after 7 days = no repeat complaint).
                                Skipped while the customer has written since. Runs every 30 min, 8 AM–8 PM. Blank = never.
                            </p>
                        </div>

                        </div>
                        <div className="space-y-3">
                        {/* ── Work & access ──────────────────────────────── */}
                        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work &amp; access</p>

                            <div className="space-y-2">
                                <Label>Work <span className="font-normal text-muted-foreground">(optional)</span></Label>
                                <Select value={editForm.workId || "__none__"} onValueChange={(value) => setEditForm((prev) => ({ ...prev, workId: value === "__none__" ? "" : value }))}>
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
                                {selectedWork?.permissionId && (
                                    <p className="text-xs text-muted-foreground">
                                        Only staff with the “{selectedWork.label}” work permission can move a ticket here. Admin always bypasses.
                                    </p>
                                )}
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Warranty scope</Label>
                                <Select
                                    value={editForm.warrantyScope}
                                    onValueChange={(value) => setEditForm((prev) => ({ ...prev, warrantyScope: value }))}
                                >
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

                            <div className="space-y-2">
                                <Label>Action label</Label>
                                <Input
                                    value={editForm.actionLabel}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, actionLabel: e.target.value }))}
                                    placeholder="e.g. New ticket received — assign a technician"
                                />
                            </div>
                            </div>
                        </div>

                        {/* ── Crossing prompts ───────────────────────────── */}
                        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Crossing prompts
                            </p>

                            <div className="space-y-2">
                                <Label>Leave prompt</Label>
                                <Input
                                    value={editForm.leavePrompt}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, leavePrompt: e.target.value }))}
                                    placeholder="e.g. Did you back up the device before moving on?"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Confirmation shown when a ticket <em>leaves</em> this status. Blank = none.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                <label className="flex cursor-pointer items-center gap-2">
                                    <Checkbox
                                        checked={editForm.announceOnEntry}
                                        onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, announceOnEntry: checked === true }))}
                                    />
                                    <span className="text-sm">Announce to customer on entry</span>
                                </label>
                                    <Input
                                        className="ml-auto h-8 w-36"
                                        aria-label="Estimated time (ETA)"
                                        title="Estimated time — the duration in the announcement. Blank = none."
                                        value={editForm.etaText}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, etaText: e.target.value }))}
                                        placeholder="ETA, e.g. 2 days"
                                        disabled={!editForm.announceOnEntry}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Public timeline note:
                                    {" "}<span className="font-medium text-foreground">
                                        “{editForm.label || editStatus?.label || "Status"} is started{editForm.etaText.trim() ? ` and will take ${editForm.etaText.trim()}` : ""}”
                                    </span>
                                </p>
                            </div>



                        </div>
                        {/* ── Customer messages on entry ─────────────────── */}
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer messages</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                            {(["waTemplate", "emailTemplate"] as const).map((key) => {
                                return (
                                    <div key={key} className="space-y-2">
                                        <Label>{key === "waTemplate" ? "WhatsApp on entry" : "Email on entry"} <span className="font-normal text-muted-foreground">(optional)</span></Label>
                                        <MessageTemplatePicker
                                            channel={key === "waTemplate" ? "whatsapp" : "email"}
                                            value={editForm[key]}
                                            onChange={(v) => setEditForm((prev) => ({ ...prev, [key]: v }))}
                                        />
                                    </div>
                                );
                            })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Sent when a ticket <em>enters</em> this status, once per ticket.
                            </p>
                        </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setEditModalId(null)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={saveEdit} disabled={savingEdit}>
                            {savingEdit ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </ScrollArea>
    );
}
