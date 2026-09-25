"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Trash2, Save, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { COLOR_OPTIONS } from "@/shared/lib/constants/badges";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

interface Pipeline {
    id: string;
    name: string;
    label: string;
    description: string | null;
    color: string;
    isDefault: boolean;
    isActive: boolean;
    order: number;
    _count: { statuses: number; tickets: number };
}

const BLANK_FORM = {
    name: "",
    label: "",
    description: "",
    color: "bg-gray-100 text-gray-600",
    isActive: true,
};

export default function PipelinesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [loading, setLoading] = useState(true);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState(BLANK_FORM);
    const [creating, setCreating] = useState(false);

    // Edit modal
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ label: "", description: "", color: "", isActive: true });
    const [editing, setEditing] = useState(false);

    const load = async () => {
        try {
            const res = await axios.get("/api/pipelines");
            setPipelines(res.data);
        } catch {
            toast.error("Failed to load pipelines");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // Workflow config is shared — a status, work or worker changed on another
    // machine announces `tickets`. Row editors hold their own draft state.
    useRealtimeTopics(["tickets"], () => { load(); });

    const handleCreate = async () => {
        if (!createForm.name.trim() || !createForm.label.trim()) {
            toast.error("Name and label are required");
            return;
        }
        setCreating(true);
        try {
            await axios.post("/api/pipelines", {
                name: createForm.name.trim().toLowerCase().replace(/\s+/g, "_"),
                label: createForm.label.trim(),
                description: createForm.description.trim() || null,
                color: createForm.color,
                isActive: createForm.isActive,
            });
            toast.success("Pipeline created");
            setShowCreate(false);
            setCreateForm(BLANK_FORM);
            load();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to create pipeline");
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (p: Pipeline) => {
        setEditId(p.id);
        setEditForm({ label: p.label, description: p.description ?? "", color: p.color, isActive: p.isActive });
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            await axios.patch(`/api/pipelines/${editId}`, {
                label: editForm.label.trim(),
                description: editForm.description.trim() || null,
                color: editForm.color,
                isActive: editForm.isActive,
            });
            toast.success("Pipeline updated");
            setEditId(null);
            load();
        } catch {
            toast.error("Failed to update pipeline");
        } finally {
            setEditing(false);
        }
    };

    const handleDelete = async (p: Pipeline) => {
        if (p.isDefault) { toast.error("Cannot delete the default pipeline"); return; }
        if (p._count.tickets > 0) { toast.error(`Cannot delete: ${p._count.tickets} ticket(s) use this pipeline`); return; }
        if (!(await confirmAction({ title: `Delete pipeline "${p.label}"?`, body: `This cannot be undone.`, confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/pipelines/${p.id}`);
            toast.success("Pipeline deleted");
            load();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to delete pipeline");
        }
    };

    const toggleActive = async (p: Pipeline) => {
        if (p.isDefault && p.isActive) { toast.error("Cannot deactivate the default pipeline"); return; }
        try {
            await axios.patch(`/api/pipelines/${p.id}`, { isActive: !p.isActive });
            load();
        } catch {
            toast.error("Failed to update pipeline");
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
        <div className="px-6 pt-3 pb-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Pipelines</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Each pipeline has its own independent set of statuses, workers, and workflow graph.
                    </p>
                </div>
                <Button onClick={() => setShowCreate(true)}>
                    <Plus size={16} /> Add Pipeline
                </Button>
            </div>

            {loading ? (
                <p className="text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid gap-4">
                    {pipelines.map((p) => (
                        <div key={p.id} className="flex items-start gap-4 rounded-lg border border-border bg-card p-5 shadow">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className={`px-2.5 py-1 text-xs font-semibold ${p.color}`}>
                                        {p.label}
                                    </span>
                                    <span className="text-xs font-mono text-muted-foreground">{p.id}</span>
                                    <span className="text-xs font-mono text-muted-foreground bg-muted border border-border px-2 py-0.5">{p.name}</span>
                                    {p.isDefault && (
                                        <span className="border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Default</span>
                                    )}
                                    {!p.isActive && (
                                        <span className="text-xs bg-muted text-muted-foreground border border-border px-2 py-0.5">Inactive</span>
                                    )}
                                </div>
                                {p.description && (
                                    <p className="text-sm text-muted-foreground mt-1.5">{p.description}</p>
                                )}
                                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                                    <span>{p._count.statuses} stage{p._count.statuses !== 1 ? "s" : ""}</span>
                                    <span>{p._count.tickets} ticket{p._count.tickets !== 1 ? "s" : ""}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleActive(p)}
                                >
                                    {p.isActive ? "Deactivate" : "Activate"}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEdit(p)}
                                >
                                    <Pencil size={13} /> Edit
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => handleDelete(p)}
                                    disabled={p.isDefault || p._count.tickets > 0}
                                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                                    title={p.isDefault ? "Cannot delete default pipeline" : p._count.tickets > 0 ? `${p._count.tickets} tickets use this pipeline` : "Delete"}
                                >
                                    <Trash2 size={15} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Dialog */}
            <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setCreateForm(BLANK_FORM); } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Pipeline</DialogTitle>
                        <DialogDescription>
                            Create a new independent pipeline with its own statuses and workflow.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="create-name">
                                Name <span className="text-muted-foreground font-normal">(slug, e.g. manufacturing)</span>
                            </Label>
                            <Input
                                id="create-name"
                                value={createForm.name}
                                onChange={(e) => setCreateForm((v) => ({ ...v, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") }))}
                                placeholder="e.g. manufacturing"
                                className="font-mono"
                            />
                            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens and underscores only.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create-label">Label</Label>
                            <Input
                                id="create-label"
                                value={createForm.label}
                                onChange={(e) => setCreateForm((v) => ({ ...v, label: e.target.value }))}
                                placeholder="e.g. Manufacturing"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create-desc">
                                Description <span className="text-muted-foreground font-normal">(optional)</span>
                            </Label>
                            <Input
                                id="create-desc"
                                value={createForm.description}
                                onChange={(e) => setCreateForm((v) => ({ ...v, description: e.target.value }))}
                                placeholder="Brief description of what this pipeline is for"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <Select
                                value={createForm.color}
                                onValueChange={(v) => setCreateForm((f) => ({ ...f, color: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((c) => (
                                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {createForm.label && (
                                <Badge className={createForm.color}>{createForm.label}</Badge>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowCreate(false); setCreateForm(BLANK_FORM); }}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={creating || !createForm.name.trim() || !createForm.label.trim()}
                        >
                            <Save size={14} /> {creating ? "Creating…" : "Create Pipeline"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={!!editId} onOpenChange={(open) => { if (!open) setEditId(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit Pipeline</DialogTitle>
                        <DialogDescription>
                            Update the label, description, and color of this pipeline.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-label">Label</Label>
                            <Input
                                id="edit-label"
                                value={editForm.label}
                                onChange={(e) => setEditForm((v) => ({ ...v, label: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-desc">
                                Description <span className="text-muted-foreground font-normal">(optional)</span>
                            </Label>
                            <Input
                                id="edit-desc"
                                value={editForm.description}
                                onChange={(e) => setEditForm((v) => ({ ...v, description: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <Select
                                value={editForm.color}
                                onValueChange={(v) => setEditForm((f) => ({ ...f, color: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((c) => (
                                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {editForm.label && (
                                <Badge className={editForm.color}>{editForm.label}</Badge>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditId(null)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleEdit}
                            disabled={editing || !editForm.label.trim()}
                        >
                            <Save size={14} /> {editing ? "Saving…" : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </ScrollArea>
    );
}
