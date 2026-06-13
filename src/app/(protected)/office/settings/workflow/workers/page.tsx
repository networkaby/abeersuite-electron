"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronRight, Copy, CornerUpLeft, GitBranch, GitMerge, Lock, Pencil, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
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
import { badgeColor, dotColor, randomHexColor } from "@/shared/lib/format/entityColor";
import { ACTION_TYPES } from "@/modules/repairing/lib/actionTypes";

// Retry-schedule channels, densest → sparsest. Each is an optional row in the
// worker dialog's "Attempts" tab; a filled row (every N × T times) becomes a phase.
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

// New workers get a random (unlimited) hex color so the workflow reads at a
// glance; the picker / hex box / preset swatches let you override it manually.
const randomColor = () => randomHexColor(Math.random());
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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
    startWorkerId?: string | null;
}

interface Worker {
    id: string;
    label: string;
    publicLabel?: string | null;
    color: string;
    workId?: string | null;
    order: number;
    statusId: string | null;
    triggerMap: Record<string, string>;
    actionLabel: string | null;
    warrantyScope?: string;
    successWorkerId?: string | null;
    failWorkerId?: string | null;
    autoRevertOnClear: boolean;
    retrySchedule?: { unit: string; every: number; times: number }[] | null;
    spawnPipelineId?: string | null;
    parentSignal?: string | null;
    actions?: WorkerActionForm[] | null;
    fromTransitions: { to: { id: string; label: string; color: string } }[];
}

interface Work {
    id: string;
    label: string;
    color: string;
    order: number;
    permissionId: string | null;
}

// One entry in a worker's action chain (6th power): a code HOOK + when it fires +
// the hook's arguments (config). The hook catalog is ACTION_TYPES (actionTypes.ts).
type WorkerActionForm = { type: string; on: "success" | "fail" | "always"; config: Record<string, string> };

type FormValues = {
    label: string;
    publicLabel: string;
    color: string;
    workId: string;
    order: string;
    statusId: string;
    triggerMap: Record<string, string>;
    actionLabel: string;
    warrantyScope: string;
    successWorkerId: string;
    failWorkerId: string;
    autoRevertOnClear: boolean;
    retryRows: RetryRows;
    spawnPipelineId: string;
    parentSignal: string;
    actions: WorkerActionForm[];
};

const BLANK_FORM: FormValues = {
    label: "",
    publicLabel: "",
    color: "bg-gray-100 text-gray-600",
    workId: "",
    order: "",
    statusId: "",
    triggerMap: {},
    actionLabel: "",
    warrantyScope: "any",
    successWorkerId: "",
    failWorkerId: "",
    autoRevertOnClear: true,
    retryRows: BLANK_RETRY_ROWS(),
    spawnPipelineId: "",
    parentSignal: "",
    actions: [],
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

function WorkerFormModal({
    open,
    title,
    form,
    setForm,
    onSave,
    onClose,
    saving,
    statuses,
    works,
    workers,
    pipelines,
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
    workers: Worker[];
    pipelines: Pipeline[];
}) {
    // A worker belongs to exactly one parent status. Changing it re-keys the
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

    // Outcome routing stays WITHIN the stage: a worker's success / unsuccess
    // target is another worker of the SAME parent status. Jumping to another
    // stage is done via "Auto-advance status to", never by a cross-status target
    // (which would leave the ticket's status and worker inconsistent).
    const sameStatusSubs = form.statusId ? workers.filter((s) => s.statusId === form.statusId) : [];

    // Update a single channel-row field (digits only, per the no-number-input rule).
    const setRetry = (unit: RetryUnit, field: keyof RetryRow, value: string) =>
        setForm({ ...form, retryRows: { ...form.retryRows, [unit]: { ...form.retryRows[unit], [field]: value.replace(/[^\d]/g, "") } } });
    const scheduleSummary = summarizeRows(form.retryRows);
    const hasSchedule = !!scheduleSummary;

    // ── Action chain (6th power) editors — each entry = a hook + when + arguments ─
    const addAction = () => setForm({ ...form, actions: [...form.actions, { type: ACTION_TYPES[0].type, on: "success", config: {} }] });
    const updateAction = (i: number, patch: Partial<WorkerActionForm>) =>
        setForm({ ...form, actions: form.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) });
    const removeAction = (i: number) => setForm({ ...form, actions: form.actions.filter((_, idx) => idx !== i) });
    const setActionConfig = (i: number, key: string, value: string) =>
        updateAction(i, { config: { ...form.actions[i].config, [key]: value } });

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Configure where this worker appears and which work it represents.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="details" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="attempts">Attempts{hasSchedule ? " ·" : ""}</TabsTrigger>
                        <TabsTrigger value="actions">Actions{form.actions.length ? ` · ${form.actions.length}` : ""}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Label <span className="text-xs font-normal text-muted-foreground">(internal)</span></Label>
                            <Input
                                value={form.label}
                                onChange={(e) => setForm({ ...form, label: e.target.value })}
                                placeholder="e.g. Waiting for Parts"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Public label <span className="text-xs font-normal text-muted-foreground">(customer portal)</span></Label>
                            <Input
                                value={form.publicLabel}
                                onChange={(e) => setForm({ ...form, publicLabel: e.target.value })}
                                placeholder="e.g. Awaiting spare parts"
                            />
                            <p className="text-xs text-muted-foreground">What the customer sees. Blank → the status name is shown.</p>
                        </div>
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
                                    : "Ungated work — any staff can set this worker."}
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
                            <Select value={form.successWorkerId || "__none__"} onValueChange={(value) => setForm({ ...form, successWorkerId: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {sameStatusSubs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>On unsuccess → move to</Label>
                            <Select value={form.failWorkerId || "__none__"} onValueChange={(value) => setForm({ ...form, failWorkerId: value === "__none__" ? "" : value })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {sameStatusSubs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <p className="-mt-3 text-xs text-muted-foreground">
                        On completing this work the caller picks Success or Unsuccess; the ticket moves to the chosen worker <span className="font-medium">within this stage</span> (green / red on the Work Inbox). If this worker has a retry schedule (Attempts tab), Unsuccess <span className="font-medium">retries first</span> and only moves to the “unsuccess” target once the schedule runs out (give-up). To jump to another stage, use “Auto-advance status to” below.
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
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    aria-label="Pick a custom color"
                                    value={HEX_RE.test(form.color) ? form.color : "#7C9EF0"}
                                    onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })}
                                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
                                />
                                <Input
                                    value={form.color}
                                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                                    placeholder="#D442D7"
                                    className="h-9 w-28 font-mono uppercase"
                                />
                                <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, color: randomColor() })} title="Random color">
                                    <RefreshCw size={13} /> Random
                                </Button>
                                <Badge {...badgeColor(form.color)}>Preview</Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {COLOR_OPTIONS.map((c) => {
                                    const selected = form.color === c.value;
                                    return (
                                        <button
                                            key={c.value}
                                            type="button"
                                            title={c.label}
                                            aria-label={c.label}
                                            aria-pressed={selected}
                                            onClick={() => setForm({ ...form, color: c.value })}
                                            className={`h-6 w-6 rounded-full border border-border/60 ${dotColor(c.value).className} transition ${selected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "hover:scale-110"}`}
                                        />
                                    );
                                })}
                            </div>
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
                                The worker auto-applied on entry is set per status — pick it
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
                                This worker belongs to exactly one status.
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

                    {/* 5th power: entering this worker spawns a CHILD ticket on another
                        pipeline (e.g. inbound parts courier). The parent mirrors the child and
                        advances via its Success/Unsuccess route when the child terminates. */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><GitBranch size={13} /> Spawn child pipeline on entry</Label>
                        <Select value={form.spawnPipelineId || "__none__"} onValueChange={(value) => setForm({ ...form, spawnPipelineId: value === "__none__" ? "" : value })}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">— none —</SelectItem>
                                {pipelines.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Landing here opens a child ticket on that pipeline (linked back to this one). When the child reaches a worker that signals back, it fires this worker’s Success / Unsuccess route. Blank = no spawn.
                        </p>
                    </div>

                    {/* Child-side report-back: when THIS worker is reached on a CHILD ticket,
                        signal the parent — fires the parent spawning worker' Success/Unsuccess. */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><CornerUpLeft size={13} /> Signal parent when reached</Label>
                        <Select value={form.parentSignal || "__none__"} onValueChange={(value) => setForm({ ...form, parentSignal: value === "__none__" ? "" : value })}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">— none —</SelectItem>
                                <SelectItem value="success">Success — resume the parent (its Success route)</SelectItem>
                                <SelectItem value="fail">Unsuccess — fail the parent (its Unsuccess route)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Only matters when THIS worker is on a spawned child. Reaching it bumps the parent off its waiting worker. Blank = silent.
                        </p>
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
                            <div className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2">
                                    <ChevronRight size={13} className="shrink-0" />
                                    <span>{scheduleSummary}, then give up</span>
                                </div>
                                <p className="mt-1 pl-[21px]">
                                    Give-up goes to the <span className="font-medium text-foreground">On unsuccess → move to</span> target (set on the Details tab).
                                </p>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="actions" className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                            Action <span className="font-medium">hooks</span> that run when this worker is <span className="font-medium">completed</span>, in order, each filtered by outcome.
                            Pick a hook and fill its arguments. See all hooks in <span className="font-medium">Workflow → Actions</span>.
                        </p>
                        {form.actions.length === 0 && (
                            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                                No actions — the worker just routes on Success / Unsuccess.
                            </div>
                        )}
                        {form.actions.map((action, i) => {
                            const def = ACTION_TYPES.find((t) => t.type === action.type);
                            return (
                                <div key={i} className="space-y-2.5 rounded-md border border-border p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                                        <Select value={action.type} onValueChange={(v) => updateAction(i, { type: v, config: {} })}>
                                            <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {ACTION_TYPES.map((t) => (<SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                        <Select value={action.on} onValueChange={(v) => updateAction(i, { on: v as WorkerActionForm["on"] })}>
                                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="success">On success</SelectItem>
                                                <SelectItem value="fail">On unsuccess</SelectItem>
                                                <SelectItem value="always">Always</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeAction(i)}>
                                            <X size={14} />
                                        </Button>
                                    </div>
                                    {def?.fields.map((field) => (
                                        <div key={field.key} className="flex items-center gap-2 pl-6">
                                            <Label className="w-28 shrink-0 text-xs">{field.label}</Label>
                                            {field.kind === "pipeline" ? (
                                                <Select value={action.config[field.key] || "__none__"} onValueChange={(v) => setActionConfig(i, field.key, v === "__none__" ? "" : v)}>
                                                    <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Pick a pipeline" /></SelectTrigger>
                                                    <SelectContent>
                                                        {pipelines.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                                                    </SelectContent>
                                                </Select>
                                            ) : field.kind === "status" ? (
                                                <Select value={action.config[field.key] || "__none__"} onValueChange={(v) => setActionConfig(i, field.key, v === "__none__" ? "" : v)}>
                                                    <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Pick a status" /></SelectTrigger>
                                                    <SelectContent>
                                                        {statuses.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input className="h-8 flex-1" value={action.config[field.key] ?? ""} onChange={(e) => setActionConfig(i, field.key, e.target.value)} placeholder={field.label} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                        <Button type="button" variant="outline" size="sm" onClick={addAction} className="w-full">
                            <Plus size={14} className="mr-1" /> Add action
                        </Button>
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

export default function WorkersPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string>("P1");
    const [statuses, setStatuses] = useState<StatusItem[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
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
            const [statusResponse, workerResponse, pipelineResponse, workResponse] = await Promise.all([
                axios.get(`/api/ticket-statuses?pipelineId=${pipelineId}`),
                axios.get(`/api/workers?pipelineId=${pipelineId}`),
                axios.get("/api/pipelines"),
                axios.get("/api/works"),
            ]);
            setStatuses((statusResponse.data as StatusItem[]).sort((a, b) => a.order - b.order));
            setWorkers(workerResponse.data);
            setPipelines(pipelineResponse.data);
            setWorks(workResponse.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(activePipelineId); }, [activePipelineId]);

    const workerPayload = (form: FormValues) => ({
        label: form.label,
        publicLabel: form.publicLabel.trim() || null,
        color: form.color,
        workId: form.workId || null,
        order: form.order ? Number(form.order) : undefined,
        statusId: form.statusId || null,
        triggerMap: form.triggerMap,
        actionLabel: form.actionLabel || null,
        warrantyScope: form.warrantyScope,
        successWorkerId: form.successWorkerId || null,
        failWorkerId: form.failWorkerId || null,
        autoRevertOnClear: form.autoRevertOnClear,
        retrySchedule: rowsToSchedule(form.retryRows),
        spawnPipelineId: form.spawnPipelineId || null,
        parentSignal: form.parentSignal || null,
        actions: form.actions,
    });

    const handleCreate = async () => {
        setCreating(true);
        try {
            const res = await axios.post("/api/workers", { ...workerPayload(createForm), pipelineId: activePipelineId });
            toast.success("Worker created");
            setShowCreate(false);
            setCreateForm(BLANK_FORM);
            // Optimistic: append the new record in place — no full reload (avoids the
            // blink + scroll-jump). The render groups/sorts by status + order.
            setWorkers((prev) => [...prev, { ...(res.data as Worker), fromTransitions: [] }]);
        } catch {
            toast.error("Failed to create");
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (worker: Worker) => {
        setEditForm({
            label: worker.label,
            publicLabel: worker.publicLabel ?? "",
            color: worker.color,
            workId: worker.workId ?? "",
            order: String(worker.order),
            statusId: worker.statusId ?? "",
            triggerMap: (worker.triggerMap ?? {}) as Record<string, string>,
            actionLabel: worker.actionLabel ?? "",
            warrantyScope: worker.warrantyScope ?? "any",
            successWorkerId: worker.successWorkerId ?? "",
            failWorkerId: worker.failWorkerId ?? "",
            autoRevertOnClear: worker.autoRevertOnClear ?? true,
            retryRows: scheduleToRows(worker.retrySchedule),
            spawnPipelineId: worker.spawnPipelineId ?? "",
            parentSignal: worker.parentSignal ?? "",
            actions: (worker.actions as WorkerActionForm[] | undefined) ?? [],
        });
        setEditId(worker.id);
    };

    // Clone: pre-fill the create modal from an existing worker (label suffixed
    // "(copy)", order auto-assigned) so the user can tweak and save a duplicate.
    const cloneWorker = (s: Worker) => {
        setCreateForm({
            label: `${s.label} (copy)`,
            publicLabel: s.publicLabel ?? "",
            color: s.color,
            workId: s.workId ?? "",
            order: "",
            statusId: s.statusId ?? "",
            triggerMap: (s.triggerMap ?? {}) as Record<string, string>,
            actionLabel: s.actionLabel ?? "",
            warrantyScope: s.warrantyScope ?? "any",
            successWorkerId: s.successWorkerId ?? "",
            failWorkerId: s.failWorkerId ?? "",
            autoRevertOnClear: s.autoRevertOnClear ?? true,
            retryRows: scheduleToRows(s.retrySchedule),
            spawnPipelineId: s.spawnPipelineId ?? "",
            parentSignal: s.parentSignal ?? "",
            actions: (s.actions as WorkerActionForm[] | undefined) ?? [],
        });
        setShowCreate(true);
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            const res = await axios.patch(`/api/workers/${editId}`, workerPayload(editForm));
            toast.success("Worker updated");
            const id = editId;
            setEditId(null);
            // Optimistic: overlay the updated scalars onto the existing row (keeps its
            // fromTransitions) — no full reload, so scroll position is preserved.
            setWorkers((prev) => prev.map((s) => s.id === id ? { ...s, ...(res.data as Partial<Worker>) } : s));
        } catch {
            toast.error("Failed to update");
        } finally {
            setEditing(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await axios.delete(`/api/workers/${id}`);
            toast.success("Worker deleted");
            // Optimistic: drop the row, and clear it as any status's start worker
            // (mirrors the DB SetNull) — no full reload.
            setWorkers((prev) => prev.filter((s) => s.id !== id));
            setStatuses((prev) => prev.map((st) => st.startWorkerId === id ? { ...st, startWorkerId: null } : st));
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to delete";
            toast.error(message ?? "Failed to delete");
        } finally {
            setDeletingId(null);
        }
    };

    // Hand-pick which worker auto-applies when a ticket ENTERS this status.
    // Persists to TicketStatus.startWorkerId (per status, not global).
    const setStart = async (statusId: string, workerId: string) => {
        try {
            await axios.patch(`/api/ticket-statuses/${statusId}`, { startWorkerId: workerId });
            toast.success("Start worker updated");
            // Optimistic: flip the start marker on that status in place — no full reload.
            setStatuses((prev) => prev.map((st) => st.id === statusId ? { ...st, startWorkerId: workerId } : st));
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to set start";
            toast.error(message ?? "Failed to set start");
        }
    };

    const openTransitionModal = (id: string) => {
        const worker = workers.find((item) => item.id === id);
        setSelectedToIds(worker?.fromTransitions.map((transition) => transition.to.id) ?? []);
        setTransitionModalId(id);
    };

    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/workers/${transitionModalId}/transitions`, { toIds: selectedToIds });
            toast.success("Transitions saved");
            const id = transitionModalId;
            const picks = selectedToIds;
            setTransitionModalId(null);
            // Optimistic: rebuild this row's fromTransitions from the picked ids
            // (label/color looked up from current rows) — no full reload.
            setWorkers((prev) => prev.map((s) => s.id === id
                ? { ...s, fromTransitions: picks.map((tid) => { const t = prev.find((x) => x.id === tid); return { to: { id: tid, label: t?.label ?? tid, color: t?.color ?? "bg-muted" } }; }) }
                : s));
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const toggleTo = (id: string) =>
        setSelectedToIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);

    // Open the create modal pre-scoped to a parent status.
    const openCreateFor = (statusId: string) => { setCreateForm({ ...BLANK_FORM, statusId, color: randomColor() }); setShowCreate(true); };

    const modalWorker = workers.find((worker) => worker.id === transitionModalId);
    // Transitions can only connect workers within the SAME parent status.
    const transitionCandidates = modalWorker
        ? workers
            .filter((worker) =>
                worker.id !== modalWorker.id &&
                worker.statusId != null &&
                worker.statusId === modalWorker.statusId
            )
            .sort((a, b) => a.order - b.order)
        : [];

    const statusLabelMap = Object.fromEntries(statuses.map((status) => [status.id, status.label]));
    const subLabelMap = Object.fromEntries(workers.map((s) => [s.id, s.label]));
    const pipelineLabelMap = Object.fromEntries(pipelines.map((p) => [p.id, p.label]));

    // One card per status (shown even when empty, so each has its own create button).
    const byParent = statuses.map((status) => ({
        status,
        children: workers
            .filter((worker) => worker.statusId === status.id)
            .sort((a, b) => a.order - b.order),
    }));

    const unassigned = workers.filter((worker) => worker.statusId == null);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="mx-auto max-w-5xl space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Workers</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Each worker belongs to one parent status — add them per status below.
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
                        // The worker hand-picked to auto-apply on entry to this status.
                        const startId = status.startWorkerId ?? null;
                        return (
                        <Card key={status.id}>
                            <CardHeader className="border-b">
                                <div className="flex items-center gap-3">
                                    <Badge className={status.color}>{status.id}</Badge>
                                    <CardTitle>{status.label}</CardTitle>
                                    <CardDescription className="ml-auto">
                                        {children.length} worker{children.length !== 1 ? "es" : ""}
                                    </CardDescription>
                                    <Button type="button" size="sm" onClick={() => openCreateFor(status.id)}>
                                        <Plus size={14} /> Add worker
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-0 px-0 pt-0">
                                {children.length === 0 && (
                                    <p className="px-6 py-4 text-xs text-muted-foreground">No workers yet — add one for this status.</p>
                                )}
                                {children.map((worker) => {
                                    const work = worker.workId ? worksById[worker.workId] : undefined;
                                    const sc = badgeColor(worker.color);
                                    return (
                                    <div key={worker.id} className="flex items-start gap-3 border-b px-6 py-4 last:border-b-0">
                                        <span
                                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums ${sc.className}`}
                                            style={sc.style}
                                            title={`Sort order ${worker.order}`}
                                        >
                                            {worker.order}
                                        </span>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">{worker.label}</span>
                                                {work && (
                                                    <Badge {...badgeColor(work.color)}>
                                                        {work.permissionId && <Lock size={10} className="mr-1" />}
                                                        {work.label}
                                                    </Badge>
                                                )}
                                                {worker.id === startId && (
                                                    <Badge className="bg-green-100 text-green-700">
                                                        <Zap size={11} className="mr-1" />Auto-applied on entry
                                                    </Badge>
                                                )}
                                                {worker.triggerMap[status.id] && (
                                                    <Badge className="bg-orange-100 text-orange-700">
                                                        <ChevronRight size={11} />
                                                        {statusLabelMap[worker.triggerMap[status.id]] ?? worker.triggerMap[status.id]}
                                                    </Badge>
                                                )}
                                                {!!worker.retrySchedule?.length && (
                                                    <Badge className="bg-amber-100 text-amber-700">
                                                        <RefreshCw size={10} className="mr-1" />
                                                        {worker.retrySchedule.map((p) => `${p.times}×${p.every}${RETRY_UNITS.find((u) => u.key === p.unit)?.abbr ?? p.unit}`).join(" → ")}
                                                    </Badge>
                                                )}
                                                {worker.spawnPipelineId && (
                                                    <Badge className="bg-indigo-100 text-indigo-700">
                                                        <GitBranch size={10} className="mr-1" />
                                                        spawns {pipelineLabelMap[worker.spawnPipelineId] ?? worker.spawnPipelineId}
                                                    </Badge>
                                                )}
                                                {worker.parentSignal && (
                                                    <Badge className={worker.parentSignal === "fail" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>
                                                        <CornerUpLeft size={10} className="mr-1" />
                                                        parent: {worker.parentSignal === "fail" ? "Unsuccess" : "Success"}
                                                    </Badge>
                                                )}
                                                {!!worker.actions?.length && (
                                                    <Badge className="bg-violet-100 text-violet-700">
                                                        <Zap size={10} className="mr-1" />
                                                        {worker.actions.length} action{worker.actions.length > 1 ? "s" : ""}
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* Work-result movement — what Success / Unsuccess do, visible without opening Edit. */}
                                            {(worker.successWorkerId || worker.failWorkerId || !!worker.retrySchedule?.length) && (
                                                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                                                    {worker.successWorkerId && (
                                                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                                                            <Check size={12} className="shrink-0" /> Success → {subLabelMap[worker.successWorkerId] ?? worker.successWorkerId}
                                                        </span>
                                                    )}
                                                    {worker.retrySchedule?.length ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                                            <X size={12} className="shrink-0" /> Unsuccess → <RefreshCw size={11} className="shrink-0" /> retries{worker.failWorkerId ? `, give up → ${subLabelMap[worker.failWorkerId] ?? worker.failWorkerId}` : ""}
                                                        </span>
                                                    ) : worker.failWorkerId ? (
                                                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                                                            <X size={12} className="shrink-0" /> Unsuccess → {subLabelMap[worker.failWorkerId] ?? worker.failWorkerId}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            )}

                                            {worker.fromTransitions.length > 0 && (
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    <span className="text-xs text-muted-foreground">Next:</span>
                                                    {worker.fromTransitions.map((transition) => (
                                                        <Badge key={transition.to.id} {...badgeColor(transition.to.color)}>
                                                            {transition.to.label}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            {worker.id !== startId && (
                                                <Button
                                                    type="button" size="sm" variant="outline"
                                                    onClick={() => setStart(status.id, worker.id)}
                                                    title="Auto-apply this worker when a ticket enters this status"
                                                >
                                                    <Zap size={13} /> Set start
                                                </Button>
                                            )}
                                            <Button type="button" size="sm" variant="outline" onClick={() => openTransitionModal(worker.id)}>
                                                <GitMerge size={13} /> Flow
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(worker)}>
                                                <Pencil size={13} /> Edit
                                            </Button>
                                            <Button type="button" size="icon-sm" variant="outline" onClick={() => cloneWorker(worker)} title="Clone this worker">
                                                <Copy size={13} />
                                            </Button>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="destructive"
                                                onClick={() => handleDelete(worker.id)}
                                                disabled={deletingId === worker.id}
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
                                {unassigned.map((worker) => (
                                    <div key={worker.id} className="flex items-center gap-3 border-b px-6 py-4 last:border-b-0">
                                        <span
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums ${badgeColor(worker.color).className}`}
                                            style={badgeColor(worker.color).style}
                                            title={`Sort order ${worker.order}`}
                                        >
                                            {worker.order}
                                        </span>
                                        <span className="flex-1 text-sm">{worker.label}</span>
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(worker)}>
                                                <Pencil size={13} /> Edit
                                            </Button>
                                            <Button type="button" size="icon-sm" variant="outline" onClick={() => cloneWorker(worker)} title="Clone this worker">
                                                <Copy size={13} />
                                            </Button>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="destructive"
                                                onClick={() => handleDelete(worker.id)}
                                                disabled={deletingId === worker.id}
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

            {/* Worker modals */}
            <WorkerFormModal
                open={showCreate}
                title="Add Worker"
                form={createForm}
                setForm={setCreateForm}
                onSave={handleCreate}
                onClose={() => setShowCreate(false)}
                saving={creating}
                statuses={statuses}
                works={works}
                workers={workers}
                pipelines={pipelines}
            />

            <WorkerFormModal
                open={!!editId}
                title={`Edit — ${workers.find((worker) => worker.id === editId)?.label ?? ""}`}
                form={editForm}
                setForm={setEditForm}
                onSave={handleEdit}
                onClose={() => setEditId(null)}
                saving={editing}
                statuses={statuses}
                works={works}
                workers={workers}
                pipelines={pipelines}
            />

            {/* Transitions dialog */}
            <Dialog open={!!transitionModalId && !!modalWorker} onOpenChange={(isOpen) => { if (!isOpen) setTransitionModalId(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Step Flow</DialogTitle>
                        <DialogDescription>
                            {modalWorker ? `Choose which workers can come after ${modalWorker.label}.` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-72 space-y-2 overflow-y-auto">
                        {transitionCandidates.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No compatible workers in the same stage.</p>
                        ) : (
                            transitionCandidates.map((candidate) => (
                                <label key={candidate.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                                    <Checkbox checked={selectedToIds.includes(candidate.id)} onCheckedChange={() => toggleTo(candidate.id)} />
                                    <Badge {...badgeColor(candidate.color)}>{candidate.id}</Badge>
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
