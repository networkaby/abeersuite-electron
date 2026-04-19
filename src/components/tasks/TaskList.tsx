"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import {
    CheckCircle2,
    Circle,
    Clock,
    AlertCircle,
    ExternalLink,
    ChevronDown,
    Loader2,
} from "lucide-react";

interface TaskTicket {
    id: number;
    device: { brand: string; model: string; customer: { name: string } };
}

export interface TaskRow {
    id: number;
    title: string;
    description: string | null;
    source: string;
    status: string;
    priority: string;
    assignedToId: number | null;
    assignedRole: string | null;
    ticketId: number | null;
    dueAt: string | null;
    completedAt: string | null;
    createdAt: string;
    assignedTo: { id: number; name: string } | null;
    createdBy: { id: number; name: string };
    ticket: TaskTicket | null;
}

const STATUS_NEXT: Record<string, string> = {
    open:        "in_progress",
    in_progress: "done",
    done:        "open",
    cancelled:   "open",
};

const STATUS_LABEL: Record<string, string> = {
    open:        "Open",
    in_progress: "In Progress",
    done:        "Done",
    cancelled:   "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
    open:        "text-gray-400",
    in_progress: "text-blue-500",
    done:        "text-green-500",
    cancelled:   "text-red-400",
};

const PRIORITY_COLOR: Record<string, string> = {
    P1: "bg-red-100 text-red-700",
    P2: "bg-orange-100 text-orange-700",
    P3: "bg-yellow-100 text-yellow-700",
    P4: "bg-gray-100 text-gray-600",
};

function isOverdue(task: TaskRow) {
    if (!task.dueAt) return false;
    if (task.status === "done" || task.status === "cancelled") return false;
    return new Date(task.dueAt) < new Date();
}

interface Props {
    tasks: TaskRow[];
    onRefresh: () => void;
}

export default function TaskList({ tasks, onRefresh }: Props) {
    const [updating, setUpdating] = useState<number | null>(null);
    const [expanded, setExpanded] = useState<number | null>(null);

    const cycleStatus = async (task: TaskRow) => {
        const next = STATUS_NEXT[task.status] ?? "open";
        setUpdating(task.id);
        try {
            await axios.patch(`/api/tasks/${task.id}`, { status: next });
            onRefresh();
        } catch {
            toast.error("Failed to update task");
        } finally {
            setUpdating(null);
        }
    };

    if (tasks.length === 0) {
        return (
            <div className="py-16 text-center text-gray-400">
                <CheckCircle2 size={36} className="mx-auto mb-3 text-green-300" />
                <p className="text-sm">No tasks here.</p>
            </div>
        );
    }

    return (
        <div className="divide-y divide-gray-100">
            {tasks.map((task) => {
                const overdue = isOverdue(task);
                const isExpanded = expanded === task.id;

                return (
                    <div key={task.id} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                        <div className="flex items-start gap-3">
                            {/* Status toggle button */}
                            <button
                                onClick={() => cycleStatus(task)}
                                disabled={updating === task.id}
                                className={`mt-0.5 shrink-0 transition-colors ${STATUS_COLOR[task.status]} hover:scale-110`}
                                title={`Mark as ${STATUS_NEXT[task.status]}`}
                            >
                                {updating === task.id ? (
                                    <Loader2 size={18} className="animate-spin text-gray-400" />
                                ) : task.status === "done" ? (
                                    <CheckCircle2 size={18} />
                                ) : task.status === "in_progress" ? (
                                    <Clock size={18} />
                                ) : task.status === "cancelled" ? (
                                    <AlertCircle size={18} />
                                ) : (
                                    <Circle size={18} />
                                )}
                            </button>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span
                                        className={`text-sm font-medium leading-snug cursor-pointer hover:text-blue-600 ${
                                            task.status === "done" ? "line-through text-gray-400" : "text-gray-800"
                                        }`}
                                        onClick={() => setExpanded(isExpanded ? null : task.id)}
                                    >
                                        {task.title}
                                    </span>

                                    {/* Badges */}
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLOR[task.priority] ?? "bg-gray-100 text-gray-600"}`}>
                                        {task.priority}
                                    </span>

                                    {task.source === "ticket_workflow" && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                                            Workflow
                                        </span>
                                    )}

                                    {task.assignedRole && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
                                            {task.assignedRole}
                                        </span>
                                    )}
                                </div>

                                {/* Meta row */}
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                    {/* Due date */}
                                    {task.dueAt && (
                                        <span className={`text-xs flex items-center gap-1 ${overdue ? "text-red-500 font-medium" : "text-gray-400"}`}>
                                            <Clock size={11} />
                                            {overdue ? "Overdue · " : "Due · "}
                                            {new Date(task.dueAt).toLocaleDateString()}
                                        </span>
                                    )}

                                    {/* Assigned to */}
                                    {task.assignedTo && (
                                        <span className="text-xs text-gray-400">
                                            → {task.assignedTo.name}
                                        </span>
                                    )}

                                    {/* Linked ticket */}
                                    {task.ticket && (
                                        <Link
                                            href={`/tickets/${task.ticket.id}`}
                                            className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
                                        >
                                            <ExternalLink size={10} />
                                            Ticket #{task.ticket.id} · {task.ticket.device.brand} {task.ticket.device.model}
                                        </Link>
                                    )}

                                    {/* Status chip */}
                                    <span className={`text-xs font-medium ${STATUS_COLOR[task.status]}`}>
                                        {STATUS_LABEL[task.status]}
                                    </span>
                                </div>

                                {/* Expanded description */}
                                {isExpanded && task.description && (
                                    <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded p-2 border border-gray-100">
                                        {task.description}
                                    </p>
                                )}
                            </div>

                            {/* Expand toggle */}
                            {task.description && (
                                <button
                                    onClick={() => setExpanded(isExpanded ? null : task.id)}
                                    className="shrink-0 text-gray-300 hover:text-gray-500 mt-0.5"
                                >
                                    <ChevronDown size={15} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
