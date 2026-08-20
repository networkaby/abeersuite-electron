"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Pencil, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import UserAvatar from "@/shared/components/UserAvatar";
import { PRIORITY_META } from "@/utils/constants";
import { formatDate, formatDateTime } from "@/shared/lib/format";
import type { TaskDetailDto, TaskDto, TaskStage } from "../lib/types";

export default function TaskDetailDialog({
    taskId,
    open,
    onOpenChange,
    stages,
    canEdit,
    canDelete,
    onEdit,
    onChanged,
}: {
    taskId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: TaskStage[];
    canEdit: boolean;
    canDelete: boolean;
    onEdit: (task: TaskDto) => void;
    onChanged: () => void;
}) {
    const [task, setTask] = useState<TaskDetailDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [comment, setComment] = useState("");
    const [posting, setPosting] = useState(false);

    const load = useCallback(async () => {
        if (!taskId) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/admin-tasks/${taskId}`);
            setTask(res.data);
        } catch {
            toast.error("Failed to load task");
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        if (open && taskId) load();
        if (!open) {
            setTask(null);
            setComment("");
        }
    }, [open, taskId, load]);

    const moveStage = async (status: string) => {
        if (!task || status === task.status) return;
        try {
            await axios.patch(`/api/admin-tasks/${task.id}`, { status });
            await load();
            onChanged();
        } catch {
            toast.error("Failed to move task");
        }
    };

    const addComment = async () => {
        if (!task || !comment.trim()) return;
        setPosting(true);
        try {
            await axios.post(`/api/admin-tasks/${task.id}/comments`, { body: comment.trim() });
            setComment("");
            await load();
            onChanged();
        } catch {
            toast.error("Failed to add comment");
        } finally {
            setPosting(false);
        }
    };

    const handleDelete = async () => {
        if (!task) return;
        if (!window.confirm("Delete this task? This cannot be undone.")) return;
        try {
            await axios.delete(`/api/admin-tasks/${task.id}`);
            toast.success("Task deleted");
            onOpenChange(false);
            onChanged();
        } catch {
            toast.error("Failed to delete task");
        }
    };

    const priority = task ? PRIORITY_META[task.priority] ?? PRIORITY_META.MEDIUM : null;
    const holders = task?.assignedPosition?.holders.map((h) => h.user) ?? [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="pr-8">{task?.title ?? (loading ? "Loading…" : "Task")}</DialogTitle>
                </DialogHeader>

                {task && (
                    <div className="space-y-5">
                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-2">
                            {priority && <Badge className={priority.color}>{priority.label}</Badge>}
                            <Badge className={task.ticketStatus.color}>{task.ticketStatus.label}</Badge>
                            {task.category && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                    {task.category}
                                </span>
                            )}
                        </div>

                        {task.description && (
                            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Assigned to (position)</div>
                                {task.assignedPosition ? (
                                    <div className="mt-1">
                                        <div className="font-medium">{task.assignedPosition.title}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {[task.assignedPosition.branch?.name, task.assignedPosition.department?.name]
                                                .filter(Boolean)
                                                .join(" · ") || "Org-wide"}
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            <span className="text-[11px] text-muted-foreground">Current holder:</span>
                                            {holders.length === 0 ? (
                                                <span className="text-xs italic text-muted-foreground">Vacant seat</span>
                                            ) : (
                                                holders.map((h) => (
                                                    <span
                                                        key={h.id}
                                                        className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs"
                                                    >
                                                        <UserAvatar name={h.name} avatarUrl={h.avatarUrl} role={h.role} sizePx={16} />
                                                        {h.name}
                                                    </span>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <span className="italic text-muted-foreground">Unassigned</span>
                                )}
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Due date</div>
                                <div className="mt-1">{task.dueDate ? formatDate(task.dueDate) : "—"}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Created by</div>
                                <div className="mt-1">
                                    {task.createdBy.userName}
                                    {task.createdBy.positionTitle ? ` · ${task.createdBy.positionTitle}` : ""}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Stage</div>
                                {canEdit ? (
                                    <Select value={task.status} onValueChange={moveStage}>
                                        <SelectTrigger className="mt-1 h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {stages.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    {s.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="mt-1">{task.ticketStatus.label}</div>
                                )}
                            </div>
                        </div>

                        {(canEdit || canDelete) && (
                            <div className="flex gap-2">
                                {canEdit && (
                                    <Button size="sm" variant="outline" onClick={() => onEdit(task)}>
                                        <Pencil className="size-4" /> Edit
                                    </Button>
                                )}
                                {canDelete && (
                                    <Button size="sm" variant="outline" className="text-red-600" onClick={handleDelete}>
                                        <Trash2 className="size-4" /> Delete
                                    </Button>
                                )}
                            </div>
                        )}

                        {/* Activity / comments */}
                        <div className="space-y-3 border-t pt-4">
                            <div className="text-sm font-medium">Activity</div>
                            <div className="space-y-3">
                                {task.comments.length === 0 && (
                                    <p className="text-xs text-muted-foreground">No activity yet.</p>
                                )}
                                {task.comments.map((c) =>
                                    c.kind === "SYSTEM" ? (
                                        <div key={c.id} className="text-xs italic text-muted-foreground">
                                            {c.author.userName} · {c.body} · {formatDateTime(c.createdAt)}
                                        </div>
                                    ) : (
                                        <div key={c.id} className="flex gap-2">
                                            <UserAvatar
                                                name={c.author.userName}
                                                avatarUrl={c.author.avatarUrl}
                                                sizePx={24}
                                            />
                                            <div className="flex-1">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-sm font-medium">{c.author.userName}</span>
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {formatDateTime(c.createdAt)}
                                                    </span>
                                                </div>
                                                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                                            </div>
                                        </div>
                                    ),
                                )}
                            </div>

                            <div className="flex gap-2">
                                <Textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="Add a comment…"
                                    rows={2}
                                    className="flex-1"
                                />
                                <Button
                                    size="icon"
                                    onClick={addComment}
                                    disabled={posting || !comment.trim()}
                                    title="Post comment"
                                >
                                    <Send className="size-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
