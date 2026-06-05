"use client";

import { Badge } from "@/components/ui/badge";
import { MessageSquare, CalendarClock } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { PRIORITY_META } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format";
import type { TaskDto, TaskPriority } from "../lib/types";

/** Left-edge accent per priority — quick visual scan down a column. */
const PRIORITY_ACCENT: Record<TaskPriority, string> = {
    LOW: "border-l-gray-300",
    MEDIUM: "border-l-blue-400",
    HIGH: "border-l-orange-400",
    URGENT: "border-l-red-500",
};

export default function TaskCard({
    task,
    draggable,
    onDragStart,
    onClick,
}: {
    task: TaskDto;
    draggable: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onClick: () => void;
}) {
    const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.MEDIUM;
    const accent = PRIORITY_ACCENT[task.priority] ?? PRIORITY_ACCENT.MEDIUM;
    const overdue =
        task.dueDate && !task.completedAt && new Date(task.dueDate).getTime() < Date.now();

    return (
        <button
            type="button"
            draggable={draggable}
            onDragStart={onDragStart}
            onClick={onClick}
            className={`w-full cursor-pointer rounded-lg border border-l-4 bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${accent} ${
                draggable ? "active:cursor-grabbing" : ""
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">{task.title}</span>
                <Badge className={`shrink-0 ${priority.color}`}>{priority.label}</Badge>
            </div>

            {task.category && (
                <span className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {task.category}
                </span>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    {task.assignee ? (
                        <span className="flex items-center gap-1.5">
                            <UserAvatar
                                name={task.assignee.name}
                                avatarUrl={task.assignee.avatarUrl}
                                role={task.assignee.role}
                                sizePx={20}
                            />
                            <span className="max-w-[90px] truncate">{task.assignee.name}</span>
                        </span>
                    ) : (
                        <span className="italic">Unassigned</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {task._count.comments > 0 && (
                        <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {task._count.comments}
                        </span>
                    )}
                    {task.dueDate && (
                        <span className={`flex items-center gap-1 ${overdue ? "text-red-600" : ""}`}>
                            <CalendarClock className="size-3" />
                            {formatDate(task.dueDate)}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}
