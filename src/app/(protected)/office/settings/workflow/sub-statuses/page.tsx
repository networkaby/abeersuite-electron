"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronRight, GitMerge, Lock, Pencil, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COLOR_OPTIONS, WARRANTY_SCOPE_OPTIONS } from "@/utils/constants";

// Retry-schedule channels, densest → sparsest. Each is an optional row in the
// sub-status dialog's "Attempts" tab; a filled row (every N × T times) becomes a phase.
const RETRY_UNITS = [
    { key: "minute", label: "Minute", abbr: "m" },
    { key: "hour", label: "Hour", abbr: "h" },
    { key: "day", label: "Day", abbr: "d" },
    { key: "week", label: "Week", abbr: "w" },
    { key: "month", label: "Month", abbr: "mo" },
    { key: "year", label: "Year", abbr: "y" },
] as const;
type RetryUnit = (typeof RETRY_UNITS)[number]["key"];
type RetryRow = { every: string; times: string };
type RetryRows = Record<RetryUnit, RetryRow>;
const BLANK_RETRY_ROWS = (): RetryRows =>
    Object.fromEntries(RETRY_UNITS.map((u) => [u.key, { every: "", times: "" }])) as RetryRows;

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
    startSubStatusId?: string | null;
}

interface SubStatus {
    id: string;
    label: string;
    color: string;
    workId?: string | null;
    order: number;
    statusId: string | null;
    triggerMap: Record<string, string>;
    actionLabel: string | null;
    warrantyScope?: string;
    successSubStatusId?: string | null;
    failSubStatusId?: string | null;
    autoRevertOnClear: boolean;
    retrySchedule?: { unit: string; every: number; times: number }[] | null;
    exhaustedSubStatusId?: string | null;
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
    statusId: string;
    triggerMap: Record<string, string>;
    actionLabel: string;
    warrantyScope: string;
    successSubStatusId: string;
    failSubStatusId: string;
    autoRevertOnClear: boolean;
    retryRows: RetryRows;
    exhaustedSubStatusId: string;
};

const BLANK_FORM: FormValues = {
    label: "",
    color: "bg-gray-100 text-gray-600",
    workId: "",
    order: "",
    statusId: "",
    triggerMap: {},
    actionLabel: "",
    warrantyScope: "any",
    successSubStatusId: "",
    failSubStatusId: "",
    autoRevertOnClear: true,
    retryRows: BLANK_RETRY_ROWS(),
    exhaustedSubStatusId: "",
};

// Build the ordered retrySchedule payload from the dialog rows (densest first).
const rowsToSchedule = (rows: RetryRows) =>
    RETRY_UNITS
        .filter((u) => rows[u.key].every.trim() && rows[u.key].times.trim())
        .map((u) => ({ unit: u.key, every: Number(rows[u.key].every), times: Number(rows[u.key].times) }));

// Decompose a saved schedule back into dialog rows for editing.
const scheduleToRows = (schedule?: { unit: string; every: number; times: number }[] | null): RetryRows => {
    const rows = BLANK_RETRY_ROWS();
    for (const p of schedule ?? []) {
        if (p.unit in rows) rows[p.unit as RetryUnit] = { every: String(p.every), times: String(p.times) };
    }
    return rows;
};

// One-line summary of a schedule, e.g. "1 now → 4×15m → 5×1d · 10 attempts".
const summarizeRows = (rows: RetryRows) => {
    const phases = rowsToSchedule(rows);
    if (!phases.length) return null;
    const abbrOf = (u: string) => RETRY_UNITS.find((x) => x.key === u)?.abbr ?? u;
    const total = phases.reduce((s, p) => s + p.times, 0) + 1;
    return `1 now → ${phases.map((p) => `${p.times}×${p.every}${abbrOf(p.unit)}`).join(" → ")} · ${total} attempts`;
};

/** Pull the `bg-*` class out of a color string for a small swatch dot. */
const bgClass = (color: string) => color.split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted";

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
    subStatuses,
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
    subStatuses: SubStatus[];
}) {
    // A sub-status belongs to exactly one parent status. Changing it re-keys the
    // single auto-advance entry (triggerMap) onto the new status.
    const setParentStatus = (value: string) => {
        const prev = form.statusId;
        const target = prev ? form.triggerMap[prev] : undefined;
        const next: Record<string, string> = {};
        if (value && target) next[value] = target;
        setForm({ ...form, statusId: value, triggerMap: next });
    };

    const setAutoAdvance = (targetId: string) => {
        if (!form.statusId) return;
        const next: Record<string, string> = {};
        if (targetId) next[form.statusId] = targetId;
        setForm({ ...form, triggerMap: next });
    };

    const selectedWork = works.find((w) => w.id === form.workId);
    const autoAdvanceTarget = form.statusId ? (form.triggerMap[form.statusId] ?? "") : "";

    // Outcome routing stays WITHIN the stage: a sub-status's success / unsuccess
    // target is another sub-status of the SAME parent status. Jumping to another
    // stage is done via "Auto-advance status to", never by a cross-status target
    // (which would leave the ticket's status and sub-status inconsistent).
    const sameStatusSubs = form.statusId ? subStatuses.filter((s) => s.statusId === form.statusId) : [];

    // Update a single channel-row field (digits only, per the no-number-input rule).
    const setRetry = (unit: RetryUnit, field: keyof RetryRow, value: string) =>
        setForm({ ...form, retryRows: { ...form.retryRows, [unit]: { ...form.retryRows[unit], [field]: value.replace(/[^\d]/g, "") } } });
    const scheduleSummary = summarizeRows(form.retryRows);
    const hasSchedule = !!scheduleSummary;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Configure where this sub-status appears and which work it represents.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="details" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="attempts">Attempts{hasSchedule ? " ·" : ""}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="space-y-5">
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>On success → move to</Label>
                            <Select value={form.successSubStatusId || "__none__"} onValueChange={(value) => setForm({ ...form, successSubStatusId: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {sameStatusSubs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>On unsuccess → move to</Label>
                            <Select value={form.failSubStatusId || "__none__"} onValueChange={(value) => setForm({ ...form, failSubStatusId: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {sameStatusSubs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <p className="-mt-3 text-xs text-muted-foreground">
                        On completing this work the caller picks Success or Unsuccess; the ticket moves to the chosen sub-status <span className="font-medium">within this stage</span> (green / red on the Work Inbox). To jump to another stage, use “Auto-advance status to” below.
                    </p>

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
                            <p className="text-xs text-muted-foreground">
                                The sub-status auto-applied on entry is set per status — pick it
                                with the <span className="font-medium">Set start</span> button on each status card.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Parent status</Label>
                            <Select value={form.statusId || "__none__"} onValueChange={(value) => setParentStatus(value === "__none__" ? "" : value)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— unassigned —</SelectItem>
                                    {statuses.map((status) => (
                                        <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                This sub-status belongs to exactly one status.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Auto-advance status to</Label>
                            <Select value={autoAdvanceTarget || "__none__"} onValueChange={(value) => setAutoAdvance(value === "__none__" ? "" : value)} disabled={!form.statusId}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="— none —" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {statuses.filter((candidate) => candidate.id !== form.statusId).map((candidate) => (
                                        <SelectItem key={candidate.id} value={candidate.id}>{candidate.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                When set here, the ticket jumps to that status.
                            </p>
                        </div>
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
                        <p className="text-xs text-muted-foreground">
                            Sort position — lower numbers show first (in lists and the ticket’s “Move” buttons). Leave blank to add at the end.
                        </p>
                    </div>
                    </TabsContent>

                    <TabsContent value="attempts" className="space-y-4">
                        <div className="flex items-start gap-2 rounded-md bg-blue-50 p-2.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            <Zap size={14} className="mt-0.5 shrink-0" />
                            <span>
                                First attempt is <span className="font-medium">immediate</span> (due now). After each <span className="font-medium">Unsuccess</span> it waits per the schedule below — densest first — then gives up. Leave a row blank to skip it.
                            </span>
                        </div>

                        <div className="grid grid-cols-[80px_1fr_1fr] gap-2 px-1 text-[11px] text-muted-foreground">
                            <span>Channel</span><span>Interval</span><span>Repeat</span>
                        </div>
                        <div className="space-y-1.5">
                            {RETRY_UNITS.map((u) => {
                                const row = form.retryRows[u.key];
                                const active = !!(row.every.trim() && row.times.trim());
                                return (
                                    <div key={u.key} className={`grid grid-cols-[80px_1fr_1fr] items-center gap-2 rounded-md px-1 py-1 ${active ? "bg-muted/60" : ""}`}>
                                        <span className={`text-sm ${active ? "font-medium" : "text-muted-foreground"}`}>{u.label}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">every</span>
                                            <Input type="text" inputMode="numeric" value={row.every} placeholder="—"
                                                onChange={(e) => setRetry(u.key, "every", e.target.value)} className="h-8 w-16 text-center" />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">×</span>
                                            <Input type="text" inputMode="numeric" value={row.times} placeholder="—"
                                                onChange={(e) => setRetry(u.key, "times", e.target.value)} className="h-8 w-16 text-center" />
                                            <span className="text-xs text-muted-foreground">times</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {scheduleSummary && (
                            <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                                <ChevronRight size={13} className="shrink-0" />
                                <span>{scheduleSummary}, then give up</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">When attempts run out → route to</Label>
                            <Select
                                value={form.exhaustedSubStatusId || "__none__"}
                                onValueChange={(value) => setForm({ ...form, exhaustedSubStatusId: value === "__none__" ? "" : value })}
                                disabled={!hasSchedule}
                            >
                                <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none (stop retrying, stay here) —</SelectItem>
                                    {sameStatusSubs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                After the last attempt the ticket routes here — often a shim that escalates or closes. Leave empty to simply stop re-arming.
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>

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
        statusId: form.statusId || null,
        triggerMap: form.triggerMap,
        actionLabel: form.actionLabel || null,
        warrantyScope: form.warrantyScope,
        successSubStatusId: form.successSubStatusId || null,
        failSubStatusId: form.failSubStatusId || null,
        autoRevertOnClear: form.autoRevertOnClear,
        retrySchedule: rowsToSchedule(form.retryRows),
        exhaustedSubStatusId: rowsToSchedule(form.retryRows).length ? (form.exhaustedSubStatusId || null) : null,
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
            statusId: subStatus.statusId ?? "",
            triggerMap: (subStatus.triggerMap ?? {}) as Record<string, string>,
            actionLabel: subStatus.actionLabel ?? "",
            warrantyScope: subStatus.warrantyScope ?? "any",
            successSubStatusId: subStatus.successSubStatusId ?? "",
            failSubStatusId: subStatus.failSubStatusId ?? "",
            autoRevertOnClear: subStatus.autoRevertOnClear ?? true,
            retryRows: scheduleToRows(subStatus.retrySchedule),
            exhaustedSubStatusId: subStatus.exhaustedSubStatusId ?? "",
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

    // Hand-pick which sub-status auto-applies when a ticket ENTERS this status.
    // Persists to TicketStatus.startSubStatusId (per status, not global).
    const setStart = async (statusId: string, subStatusId: string) => {
        try {
            await axios.patch(`/api/ticket-statuses/${statusId}`, { startSubStatusId: subStatusId });
            toast.success("Start sub-status updated");
            loadAll(activePipelineId);
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to set start";
            toast.error(message ?? "Failed to set start");
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

    // Open the create modal pre-scoped to a parent status.
    const openCreateFor = (statusId: string) => { setCreateForm({ ...BLANK_FORM, statusId }); setShowCreate(true); };

    const modalSubStatus = subStatuses.find((subStatus) => subStatus.id === transitionModalId);
    // Transitions can only connect sub-statuses within the SAME parent status.
    const transitionCandidates = modalSubStatus
        ? subStatuses
            .filter((subStatus) =>
                subStatus.id !== modalSubStatus.id &&
                subStatus.statusId != null &&
                subStatus.statusId === modalSubStatus.statusId
            )
            .sort((a, b) => a.order - b.order)
        : [];

    const statusLabelMap = Object.fromEntries(statuses.map((status) => [status.id, status.label]));
    const subLabelMap = Object.fromEntries(subStatuses.map((s) => [s.id, s.label]));

    // One card per status (shown even when empty, so each has its own create button).
    const byParent = statuses.map((status) => ({
        status,
        children: subStatuses
            .filter((subStatus) => subStatus.statusId === status.id)
            .sort((a, b) => a.order - b.order),
    }));

    const unassigned = subStatuses.filter((subStatus) => subStatus.statusId == null);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="mx-auto max-w-5xl space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Sub-Statuses</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Each sub-status belongs to one parent status — add them per status below.
                    </p>
                </div>
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
                    {byParent.map(({ status, children }) => {
                        // The sub-status hand-picked to auto-apply on entry to this status.
                        const startId = status.startSubStatusId ?? null;
                        return (
                        <Card key={status.id}>
                            <CardHeader className="border-b">
                                <div className="flex items-center gap-3">
                                    <Badge className={status.color}>{status.id}</Badge>
                                    <CardTitle>{status.label}</CardTitle>
                                    <CardDescription className="ml-auto">
                                        {children.length} sub-status{children.length !== 1 ? "es" : ""}
                                    </CardDescription>
                                    <Button type="button" size="sm" onClick={() => openCreateFor(status.id)}>
                                        <Plus size={14} /> Add sub-status
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-0 px-0 pt-0">
                                {children.length === 0 && (
                                    <p className="px-6 py-4 text-xs text-muted-foreground">No sub-statuses yet — add one for this status.</p>
                                )}
                                {children.map((subStatus) => {
                                    const work = subStatus.workId ? worksById[subStatus.workId] : undefined;
                                    return (
                                    <div key={subStatus.id} className="flex items-start gap-3 border-b px-6 py-4 last:border-b-0">
                                        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${bgClass(subStatus.color)}`} aria-hidden />

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">{subStatus.label}</span>
                                                {work && (
                                                    <Badge className={work.color}>
                                                        {work.permissionId && <Lock size={10} className="mr-1" />}
                                                        {work.label}
                                                    </Badge>
                                                )}
                                                {subStatus.id === startId && (
                                                    <Badge className="bg-green-100 text-green-700">
                                                        <Zap size={11} className="mr-1" />Auto-applied on entry
                                                    </Badge>
                                                )}
                                                {subStatus.triggerMap[status.id] && (
                                                    <Badge className="bg-orange-100 text-orange-700">
                                                        <ChevronRight size={11} />
                                                        {statusLabelMap[subStatus.triggerMap[status.id]] ?? subStatus.triggerMap[status.id]}
                                                    </Badge>
                                                )}
                                                {!!subStatus.retrySchedule?.length && (
                                                    <Badge className="bg-amber-100 text-amber-700">
                                                        <RefreshCw size={10} className="mr-1" />
                                                        {subStatus.retrySchedule.map((p) => `${p.times}×${p.every}${RETRY_UNITS.find((u) => u.key === p.unit)?.abbr ?? p.unit}`).join(" → ")}
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* Work-result movement — what Success / Unsuccess do, visible without opening Edit. */}
                                            {(subStatus.successSubStatusId || subStatus.failSubStatusId || !!subStatus.retrySchedule?.length) && (
                                                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                                                    {subStatus.successSubStatusId && (
                                                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                                                            <Check size={12} className="shrink-0" /> Success → {subLabelMap[subStatus.successSubStatusId] ?? subStatus.successSubStatusId}
                                                        </span>
                                                    )}
                                                    {subStatus.retrySchedule?.length ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                                            <X size={12} className="shrink-0" /> Unsuccess → <RefreshCw size={11} className="shrink-0" /> retries{subStatus.exhaustedSubStatusId ? `, give up → ${subLabelMap[subStatus.exhaustedSubStatusId] ?? subStatus.exhaustedSubStatusId}` : ""}
                                                        </span>
                                                    ) : subStatus.failSubStatusId ? (
                                                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                                                            <X size={12} className="shrink-0" /> Unsuccess → {subLabelMap[subStatus.failSubStatusId] ?? subStatus.failSubStatusId}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            )}

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
                                            {subStatus.id !== startId && (
                                                <Button
                                                    type="button" size="sm" variant="outline"
                                                    onClick={() => setStart(status.id, subStatus.id)}
                                                    title="Auto-apply this sub-status when a ticket enters this status"
                                                >
                                                    <Zap size={13} /> Set start
                                                </Button>
                                            )}
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
                        );
                    })}

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
                                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bgClass(subStatus.color)}`} aria-hidden />
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
                subStatuses={subStatuses}
            />

            <SubStatusFormModal
                open={!!editId}
                title={`Edit — ${subStatuses.find((subStatus) => subStatus.id === editId)?.label ?? ""}`}
                form={editForm}
                setForm={setEditForm}
                onSave={handleEdit}
                onClose={() => setEditId(null)}
                saving={editing}
                statuses={statuses}
                works={works}
                subStatuses={subStatuses}
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
