"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { toDateTimeLocalInput } from "@/shared/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import type { TaskDto, TaskPriority, TaskPositionOption } from "../lib/types";
import { useValueChange } from "@/shared/hooks/useValueChange";

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const UNASSIGNED = "__none__";

export default function TaskFormDialog({
    open,
    onOpenChange,
    positions,
    task,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    positions: TaskPositionOption[];
    /** When set, the dialog edits this task; otherwise it creates a new one. */
    task?: TaskDto | null;
    onSaved: () => void;
}) {
    const isEdit = Boolean(task);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
    const [assignedPositionId, setAssignedPositionId] = useState<string>(UNASSIGNED);
    const [dueDate, setDueDate] = useState("");
    const [saving, setSaving] = useState(false);

    // Reset form whenever the dialog opens (for create) or the target task changes
    // — while rendering, so the last task's values never paint.
    if (useValueChange<unknown>(open ? task ?? "new" : null, null) && open) {
        setTitle(task?.title ?? "");
        setDescription(task?.description ?? "");
        setCategory(task?.category ?? "");
        setPriority(task?.priority ?? "MEDIUM");
        setAssignedPositionId(task?.assignedPositionId ?? UNASSIGNED);
        setDueDate(toDateTimeLocalInput(task?.dueDate ?? null));
    }

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error("Title is required");
            return;
        }
        setSaving(true);
        const payload = {
            title: title.trim(),
            description: description.trim() || null,
            category: category.trim() || null,
            priority,
            assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
            dueDate: dueDate || null,
        };
        try {
            if (isEdit && task) {
                await axios.patch(`/api/admin-tasks/${task.id}`, payload);
                toast.success("Task updated");
            } else {
                await axios.post("/api/admin-tasks", payload);
                toast.success("Task created");
            }
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save task"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? "Update this internal work item." : "Add an internal work item to the board."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="task-title">Title</Label>
                        <Input
                            id="task-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Renew trade license"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="task-desc">Description</Label>
                        <Textarea
                            id="task-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Details, links, context…"
                            rows={3}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="task-category">Category</Label>
                            <Input
                                id="task-category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="HR, Finance…"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PRIORITIES.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {PRIORITY_META[p]?.label ?? p}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Assign to (position)</Label>
                            <Select value={assignedPositionId} onValueChange={setAssignedPositionId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                    {positions.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.title}
                                            {p.branchName ? ` · ${p.branchName}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Due date</Label>
                            <TallyDateTimeInput value={dueDate} onValueChange={setDueDate} />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !title.trim()}>
                        {isEdit ? "Save changes" : "Create task"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
