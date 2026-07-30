"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Plus, RefreshCw, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMarkSurfaceSeen } from "@/shared/hooks/useNavCounts";
import { NAV_SURFACE } from "@/shared/lib/nav/navSurfaces";
import TaskCard from "./TaskCard";
import TaskFormDialog from "./TaskFormDialog";
import TaskDetailDialog from "./TaskDetailDialog";
import type { TaskDto, TaskStage, TaskPositionOption } from "../lib/types";

export default function TaskBoard({
    stages,
    positions,
    myPositionIds,
    canManage,
}: {
    stages: TaskStage[];
    positions: TaskPositionOption[];
    /** Positions the current user holds — drives the "My tasks" filter. */
    myPositionIds: string[];
    canManage: boolean;
}) {
    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.administration);

    const router = useRouter();
    const searchParams = useSearchParams();
    const [tasks, setTasks] = useState<TaskDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [myTasksOnly, setMyTasksOnly] = useState(false);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);

    // Dialog state
    const [formOpen, setFormOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await axios.get<TaskDto[]>("/api/admin-tasks");
            setTasks(res.data);
        } catch {
            toast.error("Failed to load tasks");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Deep-link from the module button bar: /office/administration?new=1 opens the
    // create dialog, then we strip the param so a refresh doesn't reopen it.
    useEffect(() => {
        if (searchParams.get("new") !== null && canManage) {
            setEditingTask(null);
            setFormOpen(true);
            router.replace("/office/administration");
        }
    }, [searchParams, canManage, router]);

    const mySet = new Set(myPositionIds);
    const visible = myTasksOnly
        ? tasks.filter((t) => t.assignedPositionId !== null && mySet.has(t.assignedPositionId))
        : tasks;
    const byStage = (stageId: string) => visible.filter((t) => t.status === stageId);
    const totalVisible = visible.length;

    const handleDrop = async (stageId: string) => {
        setDragOverStage(null);
        const id = draggedId;
        setDraggedId(null);
        if (!id) return;
        const task = tasks.find((t) => t.id === id);
        if (!task || task.status === stageId) return;

        const targetStage = stages.find((s) => s.id === stageId);
        if (!targetStage) return;

        // Optimistic move.
        const prev = tasks;
        setTasks((ts) =>
            ts.map((t) =>
                t.id === id ? { ...t, status: stageId, ticketStatus: targetStage } : t,
            ),
        );
        try {
            await axios.patch(`/api/admin-tasks/${id}`, { status: stageId });
            load(); // resync (completedAt, comment count, etc.)
        } catch {
            setTasks(prev); // revert
            toast.error("Failed to move task");
        }
    };

    const openCreate = () => {
        setEditingTask(null);
        setFormOpen(true);
    };
    const openEdit = (task: TaskDto) => {
        setDetailOpen(false);
        setEditingTask(task);
        setFormOpen(true);
    };
    const openDetail = (id: string) => {
        setDetailId(id);
        setDetailOpen(true);
    };

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <ClipboardList className="size-5" />
                        </span>
                        <div>
                            <h1 className="text-xl font-semibold leading-none tracking-tight">Work Board</h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Internal management tasks · {totalVisible} {totalVisible === 1 ? "task" : "tasks"}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                        <Switch id="my-tasks" checked={myTasksOnly} onCheckedChange={setMyTasksOnly} />
                        <Label htmlFor="my-tasks" className="cursor-pointer text-sm">
                            My tasks
                        </Label>
                    </div>
                    <Button variant="outline" size="icon" onClick={load} title="Refresh">
                        <RefreshCw className="size-4" />
                    </Button>
                    {canManage && (
                        <Button onClick={openCreate}>
                            <Plus className="size-4" /> New Task
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
                {stages.map((stage) => {
                    const items = byStage(stage.id);
                    const isOver = dragOverStage === stage.id;
                    return (
                        <div
                            key={stage.id}
                            onDragOver={(e) => {
                                if (!canManage) return;
                                e.preventDefault();
                                setDragOverStage(stage.id);
                            }}
                            onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                            onDrop={() => canManage && handleDrop(stage.id)}
                            className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors ${
                                isOver ? "border-primary/50 bg-primary/5 ring-2 ring-primary/30" : ""
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${stage.color}`}>
                                    {stage.label}
                                </span>
                                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">
                                    {items.length}
                                </span>
                            </div>
                            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                                {loading ? (
                                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                                ) : items.length === 0 ? (
                                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground">
                                        No tasks
                                    </div>
                                ) : (
                                    items.map((task) => (
                                        <TaskCard
                                            key={task.id}
                                            task={task}
                                            draggable={canManage}
                                            onDragStart={() => setDraggedId(task.id)}
                                            onClick={() => openDetail(task.id)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <TaskFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                positions={positions}
                task={editingTask}
                onSaved={load}
            />
            <TaskDetailDialog
                taskId={detailId}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                stages={stages}
                canManage={canManage}
                onEdit={openEdit}
                onChanged={load}
            />
        </div>
    );
}
