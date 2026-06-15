"use client";

// ── DUMMY UI (not wired) ──────────────────────────────────────────────────────
// Exploring the "Action = a Work that has no human" model. An Action mirrors a Work,
// EXCEPT its human "Completion" section is replaced by an "Automation" section: pick a
// hardcoded TOOL (catalog in actionTools.ts). The tool DECLARES the inputs it needs and
// the outputs it returns; selecting it reveals those. Each input is bound to a FIXED
// value or a CONTEXT source. The tool reads its inputs, returns named outputs + a
// Success/Unsuccess boolean — so a worker routes an Action exactly like a Work.
// Nothing here is persisted yet.

import { useState } from "react";
import { Zap, ArrowRight, Plus, Pencil, Trash2, ArrowDownToLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ColorPicker, randomColor } from "@/shared/components/ColorPicker";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { ACTION_TOOLS, ACTION_TOOL_MAP, type ToolField } from "@/modules/repairing/lib/actionTools";
import { TICKET_SOURCES, USER_SOURCE } from "@/modules/repairing/lib/ticketSources";

// Context sources an input can bind to = ticket-data sources, minus "Ask the helper"
// (an Action has no human to ask).
const CONTEXT_GROUPS = [...new Set(TICKET_SOURCES.filter((s) => s.value !== USER_SOURCE).map((s) => s.group))];

// Dummy seed list — stands in for real Action rows until wired.
const DUMMY_ACTIONS = [
    { id: "act_imei", label: "Verify IMEI", color: "bg-violet-100 text-violet-700", tool: "open_tab", successLabel: "Valid", failLabel: "Invalid" },
    { id: "act_track", label: "Open courier tracking", color: "bg-amber-100 text-amber-700", tool: "open_tab", successLabel: "Opened", failLabel: "" },
];

// How a tool input is fed: a typed-in literal, or pulled from the ticket context.
type InputBinding = { mode: "fixed" | "context"; value: string };

type ActionForm = {
    label: string;
    color: string;
    group: string;
    order: string;
    gated: boolean;
    tool: string;
    bindings: Record<string, InputBinding>;   // keyed by tool-input key
    outputKeys: Record<string, string>;       // tool-output key → context key it's SAVED AS (reusable)
    successLabel: string;
    failLabel: string;
};

const BLANK: ActionForm = {
    label: "", color: "bg-gray-100 text-gray-600", group: "", order: "", gated: false,
    tool: ACTION_TOOLS[0]?.type ?? "", bindings: {}, outputKeys: {}, successLabel: "", failLabel: "",
};

// Grouped picker over ticket-context sources (mirrors the Work dialog's source dropdown).
function ContextSourceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Pick a source" /></SelectTrigger>
            <SelectContent>
                <SelectItem value="__none__">— pick —</SelectItem>
                {CONTEXT_GROUPS.map((g) => (
                    <SelectGroup key={g}>
                        <SelectLabel>{g}</SelectLabel>
                        {TICKET_SOURCES.filter((s) => s.group === g && s.value !== USER_SOURCE).map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                    </SelectGroup>
                ))}
            </SelectContent>
        </Select>
    );
}

function ActionFormBody({ form, set }: { form: ActionForm; set: (p: Partial<ActionForm>) => void }) {
    const tool = ACTION_TOOL_MAP[form.tool];
    const bindingOf = (key: string): InputBinding => form.bindings[key] ?? { mode: "context", value: "" };
    const setBinding = (key: string, patch: Partial<InputBinding>) =>
        set({ bindings: { ...form.bindings, [key]: { ...bindingOf(key), ...patch } } });
    // Each output is SAVED into the ticket context under a key (defaults to the tool's key,
    // editable) so later steps can reuse it via "From an earlier step".
    const outputKeyOf = (toolKey: string): string => form.outputKeys[toolKey] ?? toolKey;
    const setOutputKey = (toolKey: string, v: string) =>
        set({ outputKeys: { ...form.outputKeys, [toolKey]: v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") } });

    return (
        <div className="space-y-4">
            {/* ── Basics (identical to a Work) ───────────────────────── */}
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basics</p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Label</Label>
                        <Input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Verify IMEI" className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Group</Label>
                        <Select value={form.group || "__none__"} onValueChange={(v) => set({ group: v === "__none__" ? "" : v })}>
                            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="— none —" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">— none —</SelectItem>
                                <SelectItem value="g_lookup">Lookups</SelectItem>
                                <SelectItem value="g_notify">Notifications</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs">Color</Label>
                    <ColorPicker value={form.color} onChange={(c) => set({ color: c })} />
                </div>
                <div className="grid items-end gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Order <span className="font-normal text-muted-foreground">— blank = auto</span></Label>
                        <Input inputMode="numeric" value={form.order} onChange={(e) => set({ order: e.target.value })} placeholder="Auto" className="h-9" />
                    </div>
                    <label className="flex h-9 items-center gap-2 text-sm">
                        <Checkbox checked={form.gated} onCheckedChange={(c) => set({ gated: c === true })} />
                        Gated <span className="text-xs text-muted-foreground">(needs a permission)</span>
                    </label>
                </div>
            </div>

            {/* ── Automation (REPLACES Work's "Completion") ──────────── */}
            <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Zap size={12} /> Automation <span className="font-normal normal-case text-muted-foreground">— the tool that runs (instead of a human)</span>
                </p>
                <div className="space-y-1.5">
                    <Label className="text-xs">Tool</Label>
                    <Select value={form.tool} onValueChange={(v) => set({ tool: v, bindings: {}, outputKeys: {} })}>
                        <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Pick a tool" /></SelectTrigger>
                        <SelectContent>
                            {ACTION_TOOLS.map((t) => (<SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>))}
                        </SelectContent>
                    </Select>
                    {tool && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                </div>

                {tool && (
                    <>
                        {/* INPUTS the tool needs — each bound to a fixed value OR a context source */}
                        <div className="space-y-2 rounded-md border border-border bg-background/60 p-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <ArrowRight size={11} /> Inputs it needs
                            </p>
                            {tool.inputs.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
                            {tool.inputs.map((f: ToolField) => {
                                const b = bindingOf(f.key);
                                return (
                                    <div key={f.key} className="flex items-center gap-1.5">
                                        <Label className="w-20 shrink-0 text-xs">{f.label}</Label>
                                        <Select value={b.mode} onValueChange={(v) => setBinding(f.key, { mode: v as InputBinding["mode"], value: "" })}>
                                            <SelectTrigger className="h-8 w-[120px] shrink-0"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="fixed">Fixed value</SelectItem>
                                                <SelectItem value="context">From context</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {b.mode === "fixed" ? (
                                            <Input className="h-8 flex-1" value={b.value} onChange={(e) => setBinding(f.key, { value: e.target.value })} placeholder={f.hint || f.label} />
                                        ) : (
                                            <ContextSourceSelect value={b.value} onChange={(v) => setBinding(f.key, { value: v })} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* OUTPUTS it returns — SAVED to ticket context under a named key (reusable) */}
                        <div className="space-y-2 rounded-md border border-border bg-background/60 p-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <ArrowDownToLine size={11} /> Outputs it returns <span className="font-normal normal-case text-muted-foreground">— saved to the ticket context under a name you can reuse later</span>
                            </p>
                            {tool.outputs.length === 0
                                ? <p className="text-xs text-muted-foreground">No values — just the Success / Unsuccess result.</p>
                                : tool.outputs.map((o) => (
                                    <div key={o.key} className="flex items-center gap-1.5">
                                        <Label className="w-24 shrink-0 text-xs">{o.label}</Label>
                                        <span className="shrink-0 font-mono text-xs text-muted-foreground">→ context.</span>
                                        <Input
                                            value={outputKeyOf(o.key)}
                                            onChange={(e) => setOutputKey(o.key, e.target.value)}
                                            placeholder={o.key}
                                            title="The context key this output is saved as (reusable via 'From an earlier step')"
                                            className="h-8 w-44 font-mono text-xs"
                                        />
                                    </div>
                                ))}
                            <p className="text-[11px] text-muted-foreground">
                                Plus a <span className="font-medium text-green-700">Success</span> / <span className="font-medium text-red-700">Unsuccess</span> result. Saved values appear later under <span className="font-medium">&ldquo;From an earlier step&rdquo;</span> for any Work or Action to reuse.
                            </p>
                        </div>

                        {/* Outcome captions (the labels shown on the routing buttons) */}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-green-700">Success label</Label>
                                <Input value={form.successLabel} onChange={(e) => set({ successLabel: e.target.value })} placeholder="e.g. Valid" className="h-8" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-red-700">Unsuccess label <span className="font-normal text-muted-foreground">(blank → single)</span></Label>
                                <Input value={form.failLabel} onChange={(e) => set({ failLabel: e.target.value })} placeholder="e.g. Invalid" className="h-8" />
                            </div>
                        </div>
                    </>
                )}

                <p className="text-xs text-muted-foreground">
                    The tool runs <span className="font-medium">automatically</span>, reads its inputs, and its result decides <span className="font-medium">Success / Unsuccess</span> — no popup, no human. The worker routes on these exactly like a Work.
                </p>
            </div>
        </div>
    );
}

export default function ActionsPage() {
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState<ActionForm>({ ...BLANK });
    const set = (p: Partial<ActionForm>) => setForm((f) => ({ ...f, ...p }));
    // Dummy list state so create/edit/delete behave like the Works page lifecycle.
    const [actions, setActions] = useState(DUMMY_ACTIONS);
    const deleteAction = (id: string) => setActions((list) => list.filter((a) => a.id !== id));

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-4xl space-y-6 px-6 pt-3 pb-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold">Actions</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            An <span className="font-medium">Action</span> is a Work that runs <span className="font-medium">automatically</span> — no human.
                            It looks just like a Work, but its <span className="font-medium">Completion</span> is swapped for an <span className="font-medium">Automation</span> section
                            that picks a <span className="font-medium">tool</span> (below). The tool reads its inputs and returns outputs + Success / Unsuccess.
                        </p>
                    </div>
                    <Button type="button" onClick={() => { setForm({ ...BLANK, color: randomColor() }); setShowCreate(true); }}>
                        <Plus size={16} /> Add Action
                    </Button>
                </div>

                {/* DUMMY action list */}
                <div className="space-y-2">
                    {actions.length === 0 && <p className="text-sm text-muted-foreground">No actions yet. Add the first one.</p>}
                    {actions.map((a) => (
                        <Card key={a.id}>
                            <CardHeader className="py-3">
                                <div className="flex items-center gap-3">
                                    <Badge {...badgeColor(a.color)}>{a.label}</Badge>
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Zap size={11} /> {ACTION_TOOL_MAP[a.tool]?.label ?? a.tool}
                                    </span>
                                    <span className="ml-auto flex items-center gap-2 text-xs">
                                        <Badge variant="outline" className="text-green-700">{a.successLabel}</Badge>
                                        {a.failLabel && <Badge variant="outline" className="text-red-700">{a.failLabel}</Badge>}
                                        <Button type="button" size="sm" variant="outline" onClick={() => { setForm({ ...BLANK, label: a.label, color: a.color, tool: a.tool, successLabel: a.successLabel, failLabel: a.failLabel }); setShowCreate(true); }}>
                                            <Pencil size={12} /> Edit
                                        </Button>
                                        <Button type="button" size="icon-sm" variant="destructive" onClick={() => deleteAction(a.id)} title="Deleting detaches it from any worker that uses it">
                                            <Trash2 size={13} />
                                        </Button>
                                    </span>
                                </div>
                            </CardHeader>
                        </Card>
                    ))}
                </div>

                {/* Tool catalog (hardcoded, read-only) — what an Action can run */}
                <div className="space-y-3">
                    <div>
                        <h2 className="text-sm font-semibold">Available tools</h2>
                        <p className="text-xs text-muted-foreground">
                            Hardcoded, read-only functions an Action wraps (defined in <code className="text-xs">actionTools.ts</code>). Each declares the inputs it reads and the outputs it returns.
                        </p>
                    </div>
                    {ACTION_TOOLS.map((t) => (
                        <Card key={t.type}>
                            <CardHeader className="py-3">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                                        <Zap size={12} />
                                    </span>
                                    <span className="text-sm font-medium">{t.label}</span>
                                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t.type}</code>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-2.5 pt-0 text-sm">
                                <p className="text-muted-foreground">{t.description}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-medium text-foreground">Inputs:</span>
                                    {t.inputs.length === 0 ? <span className="text-muted-foreground">none</span>
                                        : t.inputs.map((f) => (<Badge key={f.key} variant="outline" className="font-normal">{f.label} <span className="ml-1 text-muted-foreground">· {f.kind}</span></Badge>))}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <ArrowRight size={12} className="shrink-0 text-muted-foreground" />
                                    <span className="font-medium text-foreground">Outputs:</span>
                                    {t.outputs.length === 0 ? <span className="text-muted-foreground">success / unsuccess only</span>
                                        : t.outputs.map((o) => (<Badge key={o.key} variant="outline" className="font-normal">{o.label} <span className="ml-1 font-mono text-[10px] text-muted-foreground">context.{o.key}</span></Badge>))}
                                    <span className="text-muted-foreground">+ Success / Unsuccess</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/* DUMMY Add/Edit Action dialog */}
            <Dialog open={showCreate} onOpenChange={(o) => { if (!o) setShowCreate(false); }}>
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Add Action</DialogTitle>
                        <DialogDescription>An automated Work — picks a tool instead of a human completion. (Dummy — not saved.)</DialogDescription>
                    </DialogHeader>
                    <ActionFormBody form={form} set={set} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button type="button" onClick={() => setShowCreate(false)} disabled={!form.label.trim()}>Save (dummy)</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ScrollArea>
    );
}
