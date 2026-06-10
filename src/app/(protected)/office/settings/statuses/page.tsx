"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Save, ArrowUpDown, GitMerge, Users } from "lucide-react";
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
import { COLOR_OPTIONS, WARRANTY_SCOPE_OPTIONS } from "@/utils/constants";
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

interface TicketStatus {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
    isEntryPoint: boolean;
    allowedRoles?: string[];
    notifyRoles?: string[];
    actionLabel: string | null;
    warrantyScope: string;
    pipelineId: string | null;
    fromTransitions: { toStatusId: string; to: { label: string } }[];
    _count: { tickets: number };
}

export default function StatusesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string>("P1");
    const [statuses, setStatuses] = useState<TicketStatus[]>([]);
    const [roles, setRoles] = useState<{ id: string; label: string }[]>([]);
    const [loading, setLoading] = useState(true);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{ label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }>({
        label: "", color: "", order: 0, isTerminal: false, isEntryPoint: false,
    });

    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    const [rolesModalId, setRolesModalId] = useState<string | null>(null);
    const [rolesForm, setRolesForm] = useState<{
        allowedRoles: string[];
        notifyRoles: string[];
        actionLabel: string;
        warrantyScope: string;
    }>({ allowedRoles: [], notifyRoles: [], actionLabel: "", warrantyScope: "any" });
    const [savingRoles, setSavingRoles] = useState(false);

    const [addingNew, setAddingNew] = useState(false);
    const [newStatus, setNewStatus] = useState({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });

    const fetchData = async (pipelineId: string) => {
        setLoading(true);
        try {
            const [statusesResponse, rolesResponse, pipelinesResponse] = await Promise.all([
                axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
                axios.get("/api/roles"),
                axios.get("/api/pipelines"),
            ]);
            setStatuses(statusesResponse.data);
            setRoles(rolesResponse.data);
            setPipelines(pipelinesResponse.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(activePipelineId); }, [activePipelineId]);

    const switchPipeline = (id: string) => {
        setActivePipelineId(id);
        setEditingId(null);
        setAddingNew(false);
    };

    const startEdit = (status: TicketStatus) => {
        setEditingId(status.id);
        setEditValues({
            label: status.label,
            color: status.color,
            order: status.order,
            isTerminal: status.isTerminal,
            isEntryPoint: status.isEntryPoint,
        });
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: string) => {
        try {
            await axios.patch(`/api/ticket-statuses/${id}`, editValues);
            toast.success("Status updated");
            setEditingId(null);
            await fetchData(activePipelineId);
        } catch {
            toast.error("Failed to update status");
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

    const openRoles = (status: TicketStatus) => {
        setRolesModalId(status.id);
        setRolesForm({
            allowedRoles: status.allowedRoles ?? [],
            notifyRoles: status.notifyRoles ?? [],
            actionLabel: status.actionLabel ?? "",
            warrantyScope: status.warrantyScope ?? "any",
        });
    };

    const toggleRole = (field: "allowedRoles" | "notifyRoles", id: string) => {
        setRolesForm((prev) => ({
            ...prev,
            [field]: prev[field].includes(id)
                ? prev[field].filter((roleId) => roleId !== id)
                : [...prev[field], id],
        }));
    };

    const saveRoles = async () => {
        if (!rolesModalId) return;
        setSavingRoles(true);
        try {
            await axios.patch(`/api/ticket-statuses/${rolesModalId}`, {
                allowedRoles: rolesForm.allowedRoles,
                notifyRoles: rolesForm.notifyRoles,
                actionLabel: rolesForm.actionLabel || null,
                warrantyScope: rolesForm.warrantyScope,
            });
            toast.success("Role settings saved");
            setRolesModalId(null);
            await fetchData(activePipelineId);
        } catch {
            toast.error("Failed to save role settings");
        } finally {
            setSavingRoles(false);
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
    const rolesStatus = rolesModalId ? statuses.find((status) => status.id === rolesModalId) : null;
    const activePipeline = pipelines.find((pipeline) => pipeline.id === activePipelineId);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Ticket Statuses</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage status labels, colors, transitions, and role permissions per pipeline.
                    </p>
                </div>
                <Button type="button" onClick={() => setAddingNew(true)}>
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
                                    <TableHead>Who can set</TableHead>
                                    <TableHead>Notifies</TableHead>
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

                                        {editingId === status.id ? (
                                            <>
                                                <TableCell>
                                                    <Input
                                                        autoFocus
                                                        value={editValues.label}
                                                        onChange={(e) => setEditValues((prev) => ({ ...prev, label: e.target.value }))}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Select
                                                            value={editValues.color}
                                                            onValueChange={(value) => setEditValues((prev) => ({ ...prev, color: value }))}
                                                        >
                                                            <SelectTrigger className="w-48">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {COLOR_OPTIONS.map((color) => (
                                                                    <SelectItem key={color.value} value={color.value}>
                                                                        {color.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <Badge className={editValues.color}>Preview</Badge>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={editValues.order}
                                                        onChange={(e) => setEditValues((prev) => ({ ...prev, order: Number(e.target.value) }))}
                                                        className="w-20"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-2">
                                                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <Checkbox
                                                                checked={editValues.isTerminal}
                                                                onCheckedChange={(checked) => setEditValues((prev) => ({ ...prev, isTerminal: checked === true }))}
                                                            />
                                                            Terminal
                                                        </label>
                                                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <Checkbox
                                                                checked={editValues.isEntryPoint}
                                                                onCheckedChange={(checked) => setEditValues((prev) => ({ ...prev, isEntryPoint: checked === true }))}
                                                            />
                                                            Entry Point
                                                        </label>
                                                    </div>
                                                </TableCell>
                                                <TableCell colSpan={2} className="text-xs text-muted-foreground">—</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">—</TableCell>
                                                <TableCell>{status._count.tickets}</TableCell>
                                                <TableCell>
                                                    <div className="flex gap-2">
                                                        <Button type="button" size="sm" onClick={() => saveEdit(status.id)}>
                                                            <Save size={12} /> Save
                                                        </Button>
                                                        <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                                                            Cancel
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </>
                                        ) : (
                                            <>
                                                <TableCell>
                                                    <Badge className={status.color}>{status.label}</Badge>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{status.color}</TableCell>
                                                <TableCell>{status.order}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        {status.isTerminal && <Badge className="bg-red-100 text-red-700">Terminal</Badge>}
                                                        {status.isEntryPoint && <Badge className="bg-indigo-100 text-indigo-700">Entry Point</Badge>}
                                                        {!status.isTerminal && !status.isEntryPoint && (
                                                            <span className="text-xs text-muted-foreground">—</span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {(status.allowedRoles ?? []).length === 0 ? (
                                                        <span className="text-xs text-muted-foreground">Anyone</span>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {(status.allowedRoles ?? []).map((roleId) => (
                                                                <Badge key={roleId} variant="outline">
                                                                    {roles.find((role) => role.id === roleId)?.label ?? roleId}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {(status.notifyRoles ?? []).length === 0 ? (
                                                        <span className="text-xs text-muted-foreground">None</span>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {(status.notifyRoles ?? []).map((roleId) => (
                                                                <Badge key={roleId} className="bg-orange-100 text-orange-700">
                                                                    {roles.find((role) => role.id === roleId)?.label ?? roleId}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
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
                                                        <Button type="button" size="sm" variant="outline" onClick={() => startEdit(status)}>
                                                            Edit
                                                        </Button>
                                                        <Button type="button" size="sm" variant="outline" onClick={() => openRoles(status)}>
                                                            <Users size={12} /> Roles
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
                                            </>
                                        )}
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
                                            <div className="flex items-center gap-2">
                                                <Select
                                                    value={newStatus.color}
                                                    onValueChange={(value) => setNewStatus((prev) => ({ ...prev, color: value }))}
                                                >
                                                    <SelectTrigger className="w-48">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {COLOR_OPTIONS.map((color) => (
                                                            <SelectItem key={color.value} value={color.value}>
                                                                {color.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Badge className={newStatus.color}>Preview</Badge>
                                            </div>
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
                                        <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                            Set roles after creation
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

            <Dialog open={!!rolesModalId && !!rolesStatus} onOpenChange={(isOpen) => { if (!isOpen) setRolesModalId(null); }}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Role Settings</DialogTitle>
                        <DialogDescription>
                            {rolesStatus ? `Configure access and notifications for ${rolesStatus.label}.` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5">
                        <div className="space-y-2">
                            <Label>Who can move a ticket to this status?</Label>
                            <p className="text-xs text-muted-foreground">Leave all unchecked to allow any role. Admin always bypasses this.</p>
                            <div className="grid grid-cols-2 gap-2">
                                {roles.map((role) => (
                                    <label key={role.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                                        <Checkbox
                                            checked={rolesForm.allowedRoles.includes(role.id)}
                                            onCheckedChange={() => toggleRole("allowedRoles", role.id)}
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Which roles see this as an action item?</Label>
                            <p className="text-xs text-muted-foreground">These roles will see tickets in this status on their dashboard queue.</p>
                            <div className="grid grid-cols-2 gap-2">
                                {roles.map((role) => (
                                    <label key={role.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                                        <Checkbox
                                            checked={rolesForm.notifyRoles.includes(role.id)}
                                            onCheckedChange={() => toggleRole("notifyRoles", role.id)}
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Warranty scope</Label>
                            <Select
                                value={rolesForm.warrantyScope}
                                onValueChange={(value) => setRolesForm((prev) => ({ ...prev, warrantyScope: value }))}
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
                                value={rolesForm.actionLabel}
                                onChange={(e) => setRolesForm((prev) => ({ ...prev, actionLabel: e.target.value }))}
                                placeholder="e.g. New ticket received — assign a technician"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setRolesModalId(null)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={saveRoles} disabled={savingRoles}>
                            {savingRoles ? "Saving…" : "Save Role Settings"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </ScrollArea>
    );
}
