"use client";

import { useEffect, useState } from "react";
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
import type { TaskDto, TaskStage } from "../lib/types";
import { usePositionPicker, useTicketsDelta } from "@/shared/hooks";

export default function TaskBoard({
    stages,
    canCreate,
    canEdit,
    canDelete,
}: {
    stages: TaskStage[];
    canCreate: boolean;
    /** Covers the Edit button, the stage select and drag-between-columns. */
    canEdit: boolean;
    canDelete: boolean;
}) {
    // Seats, and which of them are mine ("My tasks"), come from the browser's
    // cached copy rather than a query on every open — see usePositionPicker.
    const { positions, myPositionIds } = usePositionPicker();

    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.administration);

    const router = useRouter();
    const searchParams = useSearchParams();
    const [myTasksOnly, setMyTasksOnly] = useState(false);
    const [draggedId, setDraggedId] = useState<number | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);

    // Dialog state
    const [formOpen, setFormOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
    const [detailId, setDetailId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Dexie-cached + delta-synced against the same Ticket replica the other
    // ticket-flavoured boards use, and realtime-refreshed live — see useTicketsDelta.
    const { rows: tasks, setRows: setTasks, loading, error, reload: load, afterOwnWrite } = useTicketsDelta<TaskDto>({}, {
        apiPath: "/api/admin-tasks",
        sort: (a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
    });

    useEffect(() => { if (error) toast.error("Failed to load tasks"); }, [error]);

    // Deep-link from the module button bar: /office/administration?new=1 opens the
    // create dialog, then we strip the param so a refresh doesn't reopen it.
    // Adjusted during render against a stored "last handled" key, rather than
    // in an effect — see the matching comment in DealsWorkspace.
    const [handledNewParam, setHandledNewParam] = useState<string | null>(null);
    const newParamKey = searchParams.get("new") !== null && canCreate ? searchParams.toString() : null;
    if (newParamKey !== null && handledNewParam !== newParamKey) {
        setHandledNewParam(newParamKey);
        setEditingTask(null);
        setFormOpen(true);
    }
    useEffect(() => {
        if (newParamKey !== null && handledNewParam === newParamKey) {
            router.replace("/office/administration");
        }
    }, [newParamKey, handledNewParam, router]);

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
            const { data } = await axios.patch<TaskDto>(`/api/admin-tasks/${id}`, { status: stageId });
            afterOwnWrite(data); // resync (completedAt, comment count, etc.)
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
    const openDetail = (id: number) => {
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
                    {canCreate && (
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
                                if (!canEdit) return;
                                e.preventDefault();
                                setDragOverStage(stage.id);
                            }}
                            onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                            onDrop={() => canEdit && handleDrop(stage.id)}
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
                                            draggable={canEdit}
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
                onSaved={afterOwnWrite}
            />
            <TaskDetailDialog
                taskId={detailId}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                stages={stages}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={openEdit}
                onChanged={afterOwnWrite}
            />
        </div>
    );
}
