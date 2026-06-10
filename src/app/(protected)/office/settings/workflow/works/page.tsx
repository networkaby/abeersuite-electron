"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { COLOR_OPTIONS } from "@/utils/constants";

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
    statuses: UsingItem[];
    subStatuses: UsingItem[];
}

interface Pipeline {
    id: string;
    label: string;
}

const BLANK = { label: "", color: "bg-gray-100 text-gray-600", gated: false, order: "" };

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
        setEditForm({ label: work.label, color: work.color, gated: !!work.permissionId, order: String(work.order) });
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
                <Badge key={item.id} className={item.color}>
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
                        The activity each status / sub-status represents. A <span className="font-medium">gated</span> work mints a permission you can grant from Roles; an ungated work is open to any staff.
                    </p>
                </div>
                <Button type="button" onClick={() => { setCreateForm({ ...BLANK }); setShowCreate(true); }}>
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
                        const usageCount = work.statuses.length + work.subStatuses.length;
                        return (
                            <Card key={work.id}>
                                <CardHeader className="border-b">
                                    <div className="flex items-center gap-3">
                                        <Badge className={work.color}>{work.label}</Badge>
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
                                                title={usageCount > 0 ? "Deleting detaches it from its statuses / sub-statuses" : "Delete"}
                                            >
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-4">
                                    {usageCount === 0 ? (
                                        <p className="text-sm text-muted-foreground">Not used by any status or sub-status yet.</p>
                                    ) : (
                                        <>
                                            {work.statuses.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-foreground">Statuses ({work.statuses.length})</p>
                                                    {usageBadges(work.statuses)}
                                                </div>
                                            )}
                                            {work.subStatuses.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-foreground">Sub-statuses ({work.subStatuses.length})</p>
                                                    {usageBadges(work.subStatuses)}
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
                <DialogContent className="sm:max-w-sm">
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
                            <Select value={createForm.color} onValueChange={(value) => setCreateForm({ ...createForm, color: value })}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((color) => (
                                        <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Badge className={createForm.color}>Preview</Badge>
                        </div>
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
                <DialogContent className="sm:max-w-sm">
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
                            <Select value={editForm.color} onValueChange={(value) => setEditForm({ ...editForm, color: value })}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((color) => (
                                        <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Badge className={editForm.color}>Preview</Badge>
                        </div>
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
