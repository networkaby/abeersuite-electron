"use client";

import { useEffect, useState } from "react";
import axios from "axios";
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
import { WARRANTY_SCOPE_OPTIONS } from "@/utils/constants";
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
    resolveTimeHours: number | null;
    resolveGroupId?: string | null;
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
    // Resolve time entered as days + hours (UI convenience) — combined into total
    // hours only when saving. resolveTimeHoursPart is the 0–23 remainder.
    resolveTimeDays: string;
    resolveTimeHoursPart: string;
    resolveGroupId: string;
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
    workId: "", warrantyScope: "any", actionLabel: "", leavePrompt: "", announceOnEntry: false, etaText: "",
    resolveTimeDays: "", resolveTimeHoursPart: "", resolveGroupId: "",
};

export default function StatusesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string>("P1");
    const [statuses, setStatuses] = useState<TicketStatus[]>([]);
    const [works, setWorks] = useState<Work[]>([]);
    const [groups, setGroups] = useState<WorkGroup[]>([]);
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

    const fetchData = async (pipelineId: string) => {
        setLoading(true);
        try {
            const [statusesResponse, worksResponse, pipelinesResponse, groupsResponse] = await Promise.all([
                axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
                axios.get("/api/works"),
                axios.get("/api/pipelines"),
                axios.get("/api/work-groups"),
            ]);
            setStatuses(statusesResponse.data);
            setWorks(worksResponse.data);
            setPipelines(pipelinesResponse.data);
            setGroups(groupsResponse.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(activePipelineId); }, [activePipelineId]);

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
            resolveTimeDays: status.resolveTimeHours != null ? String(Math.floor(status.resolveTimeHours / 24)) : "",
            resolveTimeHoursPart: status.resolveTimeHours != null ? String(status.resolveTimeHours % 24) : "",
            resolveGroupId: status.resolveGroupId ?? "",
        });
    };

    const saveEdit = async () => {
        if (!editModalId) return;
        if (!editForm.label.trim()) {
            toast.error("Label is required");
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
                resolveTimeHours,
                resolveGroupId: editForm.resolveGroupId || null,
            });
            toast.success("Status updated");
            setEditModalId(null);
            await fetchData(activePipelineId);
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

        if (!confirm("Delete this status? This cannot be undone.")) return;

        try {
            await axios.delete(`/api/ticket-statuses/${id}`);
            toast.success("Status deleted");
            await fetchData(activePipelineId);
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
            await fetchData(activePipelineId);
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
            await fetchData(activePipelineId);
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
                <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit status</DialogTitle>
                        <DialogDescription>
                            {editStatus ? `Configure “${editStatus.label}” (${editStatus.id}) — basics, flags, work, and crossing prompts.` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5">
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
                                Entry point = where new tickets land. Terminal = a close-out stage with no further moves.
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
                                    placeholder="0"
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
                                    placeholder="0"
                                />
                                <span className="text-sm text-muted-foreground">hours</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                A ticket sitting here longer than this is flagged
                                {" "}<span className="font-medium text-foreground">Needs attention</span> in the Work Inbox. Blank = no SLA.
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
                                    Which group this ticket shows under if it goes overdue with no work attached. Blank = none.
                                </p>
                            </div>
                        </div>

                        {/* ── Work & access ──────────────────────────────── */}
                        <div className="space-y-4 rounded-md border border-border bg-muted/30 p-3">
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
                                <p className="text-xs text-muted-foreground">
                                    {selectedWork?.permissionId
                                        ? `Only staff with the “${selectedWork.label}” work permission can move a ticket to this status. Admin always bypasses.`
                                        : "Ungated — any staff can move a ticket to this status."}
                                </p>
                            </div>

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

                        {/* ── Crossing prompts ───────────────────────────── */}
                        <div className="space-y-4 rounded-md border border-border bg-muted/30 p-3">
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
                                    Shown as a confirmation in the move dialog when a ticket <em>leaves</em> this status. Blank = no prompt.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="flex cursor-pointer items-center gap-2">
                                    <Checkbox
                                        checked={editForm.announceOnEntry}
                                        onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, announceOnEntry: checked === true }))}
                                    />
                                    <span className="text-sm">Announce to customer on entry</span>
                                </label>
                                <p className="text-xs text-muted-foreground">
                                    Posts a public timeline message when a ticket <em>enters</em> this status:
                                    {" "}<span className="font-medium text-foreground">
                                        “{editForm.label || editStatus?.label || "Status"} is started{editForm.etaText.trim() ? ` and will take ${editForm.etaText.trim()}` : ""}”
                                    </span>
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>Estimated time (ETA)</Label>
                                <Input
                                    value={editForm.etaText}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, etaText: e.target.value }))}
                                    placeholder="e.g. 2 days"
                                    disabled={!editForm.announceOnEntry}
                                />
                                <p className="text-xs text-muted-foreground">
                                    The “Y” in the announcement. Blank = announce without a duration.
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
