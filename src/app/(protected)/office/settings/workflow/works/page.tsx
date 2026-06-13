"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lock, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { X } from "lucide-react";
import { badgeColor, randomHexColor } from "@/shared/lib/format/entityColor";
import { TICKET_SOURCES, USER_SOURCE, type WorkArg } from "@/modules/repairing/lib/ticketSources";

// Distinct source groups for the dropdown (Customer / Device / Ticket / Input).
const SOURCE_GROUPS = [...new Set(TICKET_SOURCES.map((s) => s.group))];

// Editor for a Work's arguments — each row: label + source (a ticket field, or
// "Ask the user") + kind for user-given. Shared by the create & edit dialogs.
function ArgsEditor({ args, onChange }: { args: WorkArg[]; onChange: (a: WorkArg[]) => void }) {
    const add = () => onChange([...args, { key: "", label: "", source: "customer.phone" }]);
    const upd = (i: number, patch: Partial<WorkArg>) => onChange(args.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    const del = (i: number) => onChange(args.filter((_, idx) => idx !== i));
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <Label className="text-xs">Arguments <span className="font-normal text-muted-foreground">— inputs this work needs</span></Label>
                <Button type="button" variant="ghost" size="sm" onClick={add} className="h-6 px-1.5 text-xs text-primary"><Plus size={12} className="mr-0.5" /> Add</Button>
            </div>
            {args.length === 0 && <p className="text-xs text-muted-foreground">None. Add an input the work needs (e.g. a number to call, a part to order).</p>}
            {args.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <Input value={a.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Label" className="h-8 w-32 shrink-0" />
                    <span className="text-xs text-muted-foreground">←</span>
                    <Select value={a.source} onValueChange={(v) => upd(i, { source: v })}>
                        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {SOURCE_GROUPS.map((g) => (
                                <SelectGroup key={g}>
                                    <SelectLabel>{g}</SelectLabel>
                                    {TICKET_SOURCES.filter((s) => s.group === g).map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                    {a.source === USER_SOURCE && (
                        <>
                            <Select value={a.kind ?? "text"} onValueChange={(v) => upd(i, { kind: v as "text" | "number" })}>
                                <SelectTrigger className="h-8 w-[68px] shrink-0"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Text</SelectItem>
                                    <SelectItem value="number">Number</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={a.on ?? "always"} onValueChange={(v) => upd(i, { on: v as "success" | "fail" | "always" })}>
                                <SelectTrigger className="h-8 w-[112px] shrink-0" title="When to collect this input"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="always">Always</SelectItem>
                                    <SelectItem value="success">On success</SelectItem>
                                    <SelectItem value="fail">On unsuccess</SelectItem>
                                </SelectContent>
                            </Select>
                        </>
                    )}
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-muted-foreground" onClick={() => del(i)}><X size={14} /></Button>
                </div>
            ))}
        </div>
    );
}

// Random (unlimited) hex by default; the picker / hex box / Random button override.
const randomColor = () => randomHexColor(Math.random());
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Reusable hex color picker (input + hex box + Random + live preview).
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="color"
                aria-label="Pick a custom color"
                value={HEX_RE.test(value) ? value : "#7C9EF0"}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
            />
            <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#D442D7" className="h-9 w-28 font-mono uppercase" />
            <Button type="button" size="sm" variant="outline" onClick={() => onChange(randomColor())} title="Random color">
                <RefreshCw size={13} /> Random
            </Button>
            <Badge {...badgeColor(value)}>Preview</Badge>
        </div>
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
    args: WorkArg[] | null;
    statuses: UsingItem[];
    workers: UsingItem[];
}

interface Pipeline {
    id: string;
    label: string;
}

const BLANK = { label: "", color: "bg-gray-100 text-gray-600", gated: false, order: "", successLabel: "", failLabel: "", args: [] as WorkArg[] };

export default function WorksPage() {
    const [works, setWorks] = useState<Work[]>([]);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [loading, setLoading] = useState(true);

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ ...BLANK });
    const [saving, setSaving] = useState(false);

    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ ...BLANK });
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const pipelineLabel = Object.fromEntries(pipelines.map((p) => [p.id, p.label]));

    const load = async () => {
        setLoading(true);
        try {
            const [worksRes, pipelinesRes] = await Promise.all([
                axios.get("/api/works"),
                axios.get("/api/pipelines"),
            ]);
            setWorks(worksRes.data);
            setPipelines(pipelinesRes.data);
        } catch {
            toast.error("Failed to load works");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        setSaving(true);
        try {
            await axios.post("/api/works", {
                label: createForm.label,
                color: createForm.color,
                gated: createForm.gated,
                order: createForm.order ? Number(createForm.order) : undefined,
                successLabel: createForm.successLabel || null,
                failLabel: createForm.failLabel || null,
                args: createForm.args,
            });
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
        setEditForm({ label: work.label, color: work.color, gated: !!work.permissionId, order: String(work.order), successLabel: work.successLabel ?? "", failLabel: work.failLabel ?? "", args: work.args ?? [] });
    };

    const handleEdit = async () => {
        if (!editId) return;
        setSaving(true);
        try {
            await axios.patch(`/api/works/${editId}`, {
                label: editForm.label,
                color: editForm.color,
                gated: editForm.gated,
                order: editForm.order ? Number(editForm.order) : undefined,
                successLabel: editForm.successLabel || null,
                failLabel: editForm.failLabel || null,
                args: editForm.args,
            });
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
            ) : works.length === 0 ? (
                <p className="text-sm text-muted-foreground">No works yet. Add the first one.</p>
            ) : (
                <div className="space-y-4">
                    {works.map((work) => {
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
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input value={createForm.label} onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })} placeholder="e.g. Cleaning" />
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <ColorPicker value={createForm.color} onChange={(c) => setCreateForm({ ...createForm, color: c })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-green-700">Success button</Label>
                                <Input value={createForm.successLabel} onChange={(e) => setCreateForm({ ...createForm, successLabel: e.target.value })} placeholder="e.g. Reachable" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-red-700">Unsuccess button</Label>
                                <Input value={createForm.failLabel} onChange={(e) => setCreateForm({ ...createForm, failLabel: e.target.value })} placeholder="e.g. Unreachable" />
                            </div>
                            <p className="col-span-2 text-xs text-muted-foreground">Custom labels for the two outcome buttons. Blank → generic Success / Unsuccess.</p>
                        </div>
                        <ArgsEditor args={createForm.args} onChange={(a) => setCreateForm({ ...createForm, args: a })} />
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={createForm.gated} onCheckedChange={(checked) => setCreateForm({ ...createForm, gated: checked === true })} />
                            Gated (requires a permission to set)
                        </label>
                        <div className="space-y-2">
                            <Label>Order</Label>
                            <Input type="text" inputMode="numeric" value={createForm.order} onChange={(e) => setCreateForm({ ...createForm, order: e.target.value })} placeholder="Auto-assigned if blank" />
                        </div>
                    </div>
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
                        <DialogDescription>Rename, recolour, or change gating.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <ColorPicker value={editForm.color} onChange={(c) => setEditForm({ ...editForm, color: c })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-green-700">Success button</Label>
                                <Input value={editForm.successLabel} onChange={(e) => setEditForm({ ...editForm, successLabel: e.target.value })} placeholder="e.g. Reachable" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-red-700">Unsuccess button</Label>
                                <Input value={editForm.failLabel} onChange={(e) => setEditForm({ ...editForm, failLabel: e.target.value })} placeholder="e.g. Unreachable" />
                            </div>
                            <p className="col-span-2 text-xs text-muted-foreground">Custom labels for the two outcome buttons. Blank → generic Success / Unsuccess.</p>
                        </div>
                        <ArgsEditor args={editForm.args} onChange={(a) => setEditForm({ ...editForm, args: a })} />
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={editForm.gated} onCheckedChange={(checked) => setEditForm({ ...editForm, gated: checked === true })} />
                            Gated (requires a permission to set)
                        </label>
                        <div className="space-y-2">
                            <Label>Order</Label>
                            <Input type="text" inputMode="numeric" value={editForm.order} onChange={(e) => setEditForm({ ...editForm, order: e.target.value })} />
                        </div>
                    </div>
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
