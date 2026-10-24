"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { ColorPicker, randomColor } from "@/shared/components/ColorPicker";
import { TICKET_SOURCES, USER_SOURCE, isUserArg, isEntryArg, isOutcomeArg, contextSource, outcomeVariables, type WorkArg } from "@/modules/repairing/lib/ticketSources";

// Worker-context groups = the dropdown groups MINUS the "Ask the helper" input source.
// "Ask the helper" is the reverse direction (collected, not shown) and lives in the
// separate Outcome section — never offered among context sources.
const CONTEXT_GROUPS = [...new Set(TICKET_SOURCES.filter((s) => s.value !== USER_SOURCE).map((s) => s.group))];

// Stable-enough unique key for a new arg row. Module-level so the random call
// isn't traced into component render by the React Compiler (these are only ever
// invoked from event handlers).
const argKey = (prefix: string) => prefix + Math.random().toString(36).slice(2, 8);

// Editor for a Work's arguments, split by DIRECTION + who fills them:
//   • Worker context — info shown TO the helper. Two flavours:
//       – supply rows: auto-pulled from the ticket (source = ticket field / Latest /
//         earlier step), read-only.
//       – entry rows: typed by the TECHNICIAN on hand-off (log popup), source = user,
//         on = "entry". Saved to Ticket.context and shown as chips.
//   • Outcome — typed by the HELPER when finishing (outcome popup). source = user,
//     on = success/fail/always.
// `contextVars` = outcome variables other works produce, reusable as a context source.
function ArgsEditor({ args, onChange, contextVars }: { args: WorkArg[]; onChange: (a: WorkArg[]) => void; contextVars: { key: string; label: string }[] }) {
    const upd = (i: number, patch: Partial<WorkArg>) => onChange(args.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    const del = (i: number) => onChange(args.filter((_, idx) => idx !== i));
    const addSupply = () => onChange([...args, { key: "", label: "", source: "customer.phone" }]);
    const addEntry = () => onChange([...args, { key: "", label: "", source: USER_SOURCE, kind: "text", on: "entry" }]);
    const addOutcome = () => onChange([...args, { key: "", label: "", source: USER_SOURCE, kind: "text", on: "always" }]);

    // Keep each row's ORIGINAL index so upd/del address the real array slot after filtering.
    const indexed = args.map((a, i) => ({ a, i }));
    const supplyRows = indexed.filter(({ a }) => !isUserArg(a));
    const entryRows = indexed.filter(({ a }) => isEntryArg(a));
    const outcomeRows = indexed.filter(({ a }) => isOutcomeArg(a));

    // A user-collected key→value row (variable_name + kind) — shared by entry & outcome.
    const collectRow = ({ a, i }: { a: WorkArg; i: number }, withWhen: boolean) => (
        <div key={i} className="flex items-center gap-1.5">
            <Input value={a.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Question / label" className="h-8 flex-1" />
            <Input
                value={a.key ?? ""}
                onChange={(e) => upd(i, { key: e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") })}
                placeholder="variable_name"
                title="Variable name other works can reuse (blank = auto from label)"
                className="h-8 w-32 shrink-0 font-mono text-xs"
            />
            <Select value={a.kind ?? "text"} onValueChange={(v) => upd(i, { kind: v as "text" | "number" })}>
                <SelectTrigger className="h-8 w-[68px] shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                </SelectContent>
            </Select>
            {withWhen && (
                <Select value={a.on ?? "always"} onValueChange={(v) => upd(i, { on: v as "success" | "fail" | "always" })}>
                    <SelectTrigger className="h-8 w-[112px] shrink-0" title="When to collect this input"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="always">Always</SelectItem>
                        <SelectItem value="success">On success</SelectItem>
                        <SelectItem value="fail">On unsuccess</SelectItem>
                    </SelectContent>
                </Select>
            )}
            <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground" title="Required — block the move/finish until this is filled">
                <Checkbox checked={!!a.required} onCheckedChange={(c) => upd(i, { required: c === true })} /> req
            </label>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-muted-foreground" onClick={() => del(i)}><X size={14} /></Button>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* ── Worker context — shown TO the helper ───────────────────────── */}
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                {/* Supply rows — auto-pulled from the ticket (read-only). */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Worker context <span className="font-normal text-muted-foreground">— shown to the helper as read-only chips</span></Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addSupply} className="h-6 px-1.5 text-xs text-primary"><Plus size={12} className="mr-0.5" /> Add</Button>
                    </div>
                    {supplyRows.length === 0 && <p className="text-xs text-muted-foreground">None. Add a ticket field to show the helper (e.g. the number to call, the device model).</p>}
                    {supplyRows.map(({ a, i }) => (
                        <div key={i} className="flex items-center gap-1.5">
                            <Input value={a.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Label" className="h-8 w-32 shrink-0" />
                            <span className="text-xs text-muted-foreground">←</span>
                            <Select value={a.source} onValueChange={(v) => upd(i, { source: v })}>
                                <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CONTEXT_GROUPS.map((g) => (
                                        <SelectGroup key={g}>
                                            <SelectLabel>{g}</SelectLabel>
                                            {TICKET_SOURCES.filter((s) => s.group === g && s.value !== USER_SOURCE).map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                                        </SelectGroup>
                                    ))}
                                    {contextVars.length > 0 && (
                                        <SelectGroup>
                                            <SelectLabel>From an earlier step (outcome)</SelectLabel>
                                            {contextVars.map((v) => (<SelectItem key={v.key} value={contextSource(v.key)}><span className="font-mono text-xs">{v.key}</span></SelectItem>))}
                                        </SelectGroup>
                                    )}
                                </SelectContent>
                            </Select>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-muted-foreground" onClick={() => del(i)}><X size={14} /></Button>
                        </div>
                    ))}
                </div>

                {/* Entry rows — typed by the technician on hand-off (in the log popup). */}
                <div className="space-y-2 border-t border-border/60 pt-2.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Ask the technician <span className="font-normal text-muted-foreground">— filled on hand-off (log popup); shown to the helper</span></Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addEntry} className="h-6 px-1.5 text-xs text-primary"><Plus size={12} className="mr-0.5" /> Add</Button>
                    </div>
                    {entryRows.length === 0 && <p className="text-xs text-muted-foreground">None. Add a field the technician types when handing the ticket in (e.g. access password, preferred call time).</p>}
                    {entryRows.map((row) => collectRow(row, false))}
                </div>
            </div>

            {/* ── Outcome — collected FROM the helper ────────────────────────── */}
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                    <Label className="text-xs">Outcome <span className="font-normal text-muted-foreground">— info the helper types when finishing the work</span></Label>
                    <Button type="button" variant="ghost" size="sm" onClick={addOutcome} className="h-6 px-1.5 text-xs text-primary"><Plus size={12} className="mr-0.5" /> Add</Button>
                </div>
                {outcomeRows.length === 0 && <p className="text-xs text-muted-foreground">None. Add a question the helper answers (e.g. the number reached, why it failed). Their answer is saved and reusable later.</p>}
                {outcomeRows.map((row) => collectRow(row, true))}
            </div>
        </div>
    );
}

type WorkFormValues = {
    label: string;
    color: string;
    gated: boolean;
    order: string;
    successLabel: string;
    failLabel: string;
    prompt: string;
    startLabel: string;
    successPopup: boolean;
    failPopup: boolean;
    args: WorkArg[];
    groupIds: string[];
};

const BLANK: WorkFormValues = {
    label: "", color: "bg-gray-100 text-gray-600", gated: false, order: "",
    successLabel: "", failLabel: "", prompt: "", startLabel: "", successPopup: false, failPopup: false,
    args: [], groupIds: [],
};

// The full Add/Edit Work form body — shared by both dialogs so they can't drift.
// Two tabs: "Setup" (Basics / Worker context / Completion sections) and "Arguments".
// The Worker-context checklist and the per-outcome popup questions both edit the same
// `form.args` array (single source of truth with the Arguments tab).
function WorkFormBody({ form, set, groups, contextVars }: {
    form: WorkFormValues;
    set: (patch: Partial<WorkFormValues>) => void;
    groups: { id: string; name: string; label: string }[];
    contextVars: { key: string; label: string }[];
}) {
    const args = form.args;
    const onArgs = (a: WorkArg[]) => set({ args: a });

    // Worker context = a SUPPLY arg per ticket field (source ≠ user), shown silently.
    const supplyArg = (source: string) => args.find((a) => a.source === source);
    const toggleSupply = (source: string, label: string, on: boolean) => {
        const existing = supplyArg(source);
        if (on) { if (!existing) onArgs([...args, { key: argKey("c"), label, source }]); }
        else if (existing) onArgs(args.filter((a) => a !== existing));
    };

    // The per-outcome popup question IS the first "ask the user" arg scoped to that
    // outcome — its label is the question shown on the ticket page.
    const qArg = (on: "success" | "fail") => args.find((a) => a.source === USER_SOURCE && (a.on ?? "always") === on);
    const qVal = (on: "success" | "fail") => qArg(on)?.label ?? "";
    const setQ = (on: "success" | "fail", text: string) => {
        const existing = qArg(on);
        if (!text.trim()) { onArgs(existing ? args.filter((a) => a !== existing) : args); return; }
        if (existing) onArgs(args.map((a) => (a === existing ? { ...a, label: text } : a)));
        else onArgs([...args, { key: argKey("q"), label: text, source: USER_SOURCE, kind: "text", on }]);
    };
    // Plain JSX helper (NOT a nested component — that would drop focus each keystroke).
    const questionRow = (on: "success" | "fail", show: boolean) => show && (
        <div className="space-y-1">
            <Label className={`text-xs ${on === "success" ? "text-green-700" : "text-red-700"}`}>
                {on === "success" ? "Success" : "Unsuccess"} popup question
            </Label>
            <Input
                value={qVal(on)}
                onChange={(e) => setQ(on, e.target.value)}
                placeholder={on === "success" ? "e.g. Please enter the number you reached" : "e.g. Why was it unsuccessful?"}
                className="h-8 text-xs"
            />
        </div>
    );

    return (
        <Tabs defaultValue="setup" className="w-full">
            <TabsList className="w-full">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="arguments">Arguments{args.length ? ` (${args.length})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="space-y-4 pt-2">
                {/* ── Basics ─────────────────────────────────────────────── */}
                <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basics</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Label</Label>
                            <Input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Cleaning" className="h-9" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Groups</Label>
                            {groups.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No work groups yet.</p>
                            ) : (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                                    {groups.map((g) => (
                                        <label key={g.id} className="flex items-center gap-1.5 text-xs">
                                            <Checkbox
                                                checked={form.groupIds.includes(g.id)}
                                                onCheckedChange={(c) => set({
                                                    groupIds: c === true
                                                        ? [...form.groupIds, g.id]
                                                        : form.groupIds.filter((id) => id !== g.id),
                                                })}
                                            />
                                            {g.label}
                                            {g.name && g.name !== g.label && <span className="text-muted-foreground">({g.name})</span>}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Color</Label>
                        <ColorPicker value={form.color} onChange={(c) => set({ color: c })} />
                    </div>
                    <div className="grid items-end gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Order <span className="font-normal text-muted-foreground">— blank = auto</span></Label>
                            <Input type="text" inputMode="numeric" value={form.order} onChange={(e) => set({ order: e.target.value })} placeholder="Auto" className="h-9" />
                        </div>
                        <label className="flex h-9 items-center gap-2 text-sm">
                            <Checkbox checked={form.gated} onCheckedChange={(c) => set({ gated: c === true })} />
                            Gated <span className="text-xs text-muted-foreground">(needs a permission)</span>
                        </label>
                    </div>
                </div>

                {/* ── Worker context ─────────────────────────────────────── */}
                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Worker context <span className="font-normal normal-case text-muted-foreground">— ticket info shown silently on the card (no popup)</span>
                    </p>
                    <div className="space-y-1">
                        {CONTEXT_GROUPS.map((g) => (
                            <div key={g} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{g}</span>
                                {TICKET_SOURCES.filter((s) => s.group === g && s.value !== USER_SOURCE).map((s) => (
                                    <label key={s.value} className="flex items-center gap-1.5 text-xs">
                                        <Checkbox checked={!!supplyArg(s.value)} onCheckedChange={(c) => toggleSupply(s.value, s.label, c === true)} />
                                        {s.label}
                                    </label>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Completion ─────────────────────────────────────────── */}
                <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completion</p>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Prompt <span className="font-normal text-muted-foreground">— guidance at the top of the completion popup (when one opens)</span></Label>
                        <Input value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="e.g. Add alternative number of customer if you know" className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Start button <span className="font-normal text-muted-foreground">— optional; makes it 2-step &amp; claims the card first</span></Label>
                        <Input value={form.startLabel} onChange={(e) => set({ startLabel: e.target.value })} placeholder="e.g. Make a call  (blank → outcomes show directly)" className="h-9" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-green-700">Success button</Label>
                            <div className="flex items-center gap-2">
                                <Input value={form.successLabel} onChange={(e) => set({ successLabel: e.target.value })} placeholder="e.g. Reachable" className="h-8 flex-1" />
                                <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                                    <Checkbox checked={form.successPopup} onCheckedChange={(c) => set({ successPopup: c === true })} /> popup
                                </label>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-red-700">Unsuccess button <span className="font-normal text-muted-foreground">(blank → single button)</span></Label>
                            <div className="flex items-center gap-2">
                                <Input value={form.failLabel} onChange={(e) => set({ failLabel: e.target.value })} placeholder="e.g. Unreachable" className="h-8 flex-1" />
                                <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                                    <Checkbox checked={form.failPopup} onCheckedChange={(c) => set({ failPopup: c === true })} /> popup
                                </label>
                            </div>
                        </div>
                    </div>
                    {(form.successPopup || !!qVal("success") || form.failPopup || !!qVal("fail")) && (
                        <div className="space-y-2">
                            {questionRow("success", form.successPopup || !!qVal("success"))}
                            {questionRow("fail", form.failPopup || !!qVal("fail"))}
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Tick <span className="font-medium">popup</span> to ask something on that outcome, then type the question (shown to the helper on the Work Inbox; their answer is collected as the work&apos;s <span className="font-medium">outcome</span>). Leave the <span className="font-medium">Unsuccess</span> caption blank for a single-button work (e.g. &ldquo;Ok&rdquo;).
                    </p>
                </div>
            </TabsContent>

            <TabsContent value="arguments" className="pt-2">
                <ArgsEditor args={form.args} onChange={onArgs} contextVars={contextVars} />
            </TabsContent>
        </Tabs>
    );
}

interface UsingItem {
    id: string;
    label: string;
    color: string;
    pipelineId: string | null;
}

interface Work {
    id: string;
    label: string;
    color: string;
    order: number;
    permissionId: string | null;
    successLabel: string | null;
    failLabel: string | null;
    prompt: string | null;
    startLabel: string | null;
    successPopup: boolean;
    failPopup: boolean;
    args: WorkArg[] | null;
    groupIds: string[];
    groups: { id: string; label: string; color: string }[];
    kind?: string;                 // "human" (default) | "auto" (an Action — shown on the Actions page)
    toolConfig?: { outputs?: Record<string, string> } | null;
    statuses: UsingItem[];
    workers: UsingItem[];
}

interface Pipeline {
    id: string;
    label: string;
}

export default function WorksPage() {
    const [works, setWorks] = useState<Work[]>([]);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [groups, setGroups] = useState<{ id: string; name: string; label: string; color: string }[]>([]);
    const [loading, setLoading] = useState(true);

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState<WorkFormValues>({ ...BLANK });
    const [saving, setSaving] = useState(false);

    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<WorkFormValues>({ ...BLANK });
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const pipelineLabel = Object.fromEntries(pipelines.map((p) => [p.id, p.label]));

    // No `setLoading(true)` here — the spinner is for the first load only.
    // Re-showing it after every save blanked the list (blink).
    const load = () => Promise.all([
        axios.get("/api/works"),
        axios.get("/api/pipelines"),
        axios.get("/api/work-groups"),
    ])
        .then(([worksRes, pipelinesRes, groupsRes]) => {
            setWorks(worksRes.data);
            setPipelines(pipelinesRes.data);
            setGroups(groupsRes.data);
        })
        .catch(() => { toast.error("Failed to load works"); })
        .finally(() => setLoading(false));

    useEffect(() => { load(); }, []);

    // Workflow config is shared — a status, work or worker changed on another
    // machine announces `tickets`. Row editors hold their own draft state.
    useRealtimeTopics(["tickets"], () => { load(); });

    const payload = (form: WorkFormValues) => ({
        label: form.label,
        color: form.color,
        gated: form.gated,
        order: form.order ? Number(form.order) : undefined,
        successLabel: form.successLabel || null,
        failLabel: form.failLabel || null,
        prompt: form.prompt || null,
        startLabel: form.startLabel || null,
        successPopup: form.successPopup,
        failPopup: form.failPopup,
        args: form.args,
        groupIds: form.groupIds,
    });

    const handleCreate = async () => {
        setSaving(true);
        try {
            await axios.post("/api/works", payload(createForm));
            toast.success("Work created");
            setShowCreate(false);
            setCreateForm({ ...BLANK });
            load();
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to create work";
            toast.error(message ?? "Failed to create work");
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (work: Work) => {
        setEditId(work.id);
        setEditForm({
            label: work.label, color: work.color, gated: !!work.permissionId, order: String(work.order),
            successLabel: work.successLabel ?? "", failLabel: work.failLabel ?? "",
            prompt: work.prompt ?? "", startLabel: work.startLabel ?? "",
            successPopup: work.successPopup ?? false, failPopup: work.failPopup ?? false,
            args: work.args ?? [], groupIds: work.groups ? work.groups.map((g) => g.id) : [],
        });
    };

    const handleEdit = async () => {
        if (!editId) return;
        setSaving(true);
        try {
            await axios.patch(`/api/works/${editId}`, payload(editForm));
            toast.success("Work updated");
            setEditId(null);
            load();
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to update work";
            toast.error(message ?? "Failed to update work");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await axios.delete(`/api/works/${id}`);
            toast.success("Work deleted");
            load();
        } catch (err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to delete work";
            toast.error(message ?? "Failed to delete work");
        } finally {
            setDeletingId(null);
        }
    };

    const usageBadges = (items: UsingItem[]) => (
        <div className="flex flex-wrap gap-1">
            {items.map((item) => (
                <Badge key={item.id} {...badgeColor(item.color)}>
                    {item.label}
                    {item.pipelineId && pipelineLabel[item.pipelineId] && (
                        <span className="ml-1 opacity-60">· {pipelineLabel[item.pipelineId]}</span>
                    )}
                </Badge>
            ))}
        </div>
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="mx-auto max-w-4xl space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Works</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The activity each status / worker represents. A <span className="font-medium">gated</span> work mints a permission you can grant from Roles; an ungated work is open to any staff.
                    </p>
                </div>
                <Button type="button" onClick={() => { setCreateForm({ ...BLANK, color: randomColor() }); setShowCreate(true); }}>
                    <Plus size={16} /> Add Work
                </Button>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : works.filter((w) => w.kind !== "auto").length === 0 ? (
                <p className="text-sm text-muted-foreground">No works yet. Add the first one.</p>
            ) : (
                <div className="space-y-4">
                    {works.filter((w) => w.kind !== "auto").map((work) => {
                        const usageCount = work.statuses.length + work.workers.length;
                        return (
                            <Card key={work.id}>
                                <CardHeader className="border-b">
                                    <div className="flex items-center gap-3">
                                        <Badge {...badgeColor(work.color)}>{work.label}</Badge>
                                        {work.permissionId ? (
                                            <Badge variant="outline" className="gap-1 text-amber-700">
                                                <Lock size={11} /> Gated
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-muted-foreground">Ungated</Badge>
                                        )}
                                        {work.groups.map((g) => (
                                            <Badge key={g.id} {...badgeColor(g.color)}>{g.label}</Badge>
                                        ))}
                                        <CardTitle className="ml-auto text-sm font-normal text-muted-foreground">
                                            {usageCount} use{usageCount !== 1 ? "s" : ""}
                                        </CardTitle>
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(work)}>
                                                <Pencil size={13} /> Edit
                                            </Button>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="destructive"
                                                onClick={() => handleDelete(work.id)}
                                                disabled={deletingId === work.id}
                                                title={usageCount > 0 ? "Deleting detaches it from its statuses / workers" : "Delete"}
                                            >
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-4">
                                    {usageCount === 0 ? (
                                        <p className="text-sm text-muted-foreground">Not used by any status or worker yet.</p>
                                    ) : (
                                        <>
                                            {work.statuses.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-foreground">Statuses ({work.statuses.length})</p>
                                                    {usageBadges(work.statuses)}
                                                </div>
                                            )}
                                            {work.workers.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-foreground">Workers ({work.workers.length})</p>
                                                    {usageBadges(work.workers)}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Create dialog */}
            <Dialog open={showCreate} onOpenChange={(isOpen) => { if (!isOpen) setShowCreate(false); }}>
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Add Work</DialogTitle>
                        <DialogDescription>The work id is auto-generated from the label.</DialogDescription>
                    </DialogHeader>
                    <WorkFormBody form={createForm} set={(p) => setCreateForm({ ...createForm, ...p })} groups={groups} contextVars={outcomeVariables(works)} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button type="button" onClick={handleCreate} disabled={saving || !createForm.label.trim()}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit dialog */}
            <Dialog open={!!editId} onOpenChange={(isOpen) => { if (!isOpen) setEditId(null); }}>
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Edit Work</DialogTitle>
                        <DialogDescription>Rename, recolour, change gating, or set the work&apos;s shape.</DialogDescription>
                    </DialogHeader>
                    <WorkFormBody form={editForm} set={(p) => setEditForm({ ...editForm, ...p })} groups={groups} contextVars={outcomeVariables(works)} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                        <Button type="button" onClick={handleEdit} disabled={saving || !editForm.label.trim()}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </ScrollArea>
    );
}
