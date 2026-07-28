"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, RefreshCw, Repeat, Pencil, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { extractApiError } from "@/shared/lib/api";
import { formatDate, formatRupeesFromPaise } from "@/shared/lib/format";
import { useDeleteWithConfirm } from "@/shared/hooks";
import { PRIORITY_META } from "@/utils/constants";
import RecurringTaskFormDialog from "./RecurringTaskFormDialog";
import type { TaskRecurrenceDto, TaskPositionOption } from "../lib/types";

const UNIT_LABEL: Record<string, [string, string]> = {
    day: ["day", "days"],
    week: ["week", "weeks"],
    month: ["month", "months"],
    year: ["year", "years"],
};

/** "Every month" / "Every 3 months" — reads like a sentence, not a config row. */
function repeatLabel(r: TaskRecurrenceDto): string {
    const [one, many] = UNIT_LABEL[r.unit] ?? [r.unit, `${r.unit}s`];
    return r.every === 1 ? `Every ${one}` : `Every ${r.every} ${many}`;
}

/** "#3 of 12" for a fixed run, "7 created" for an endless one. */
function progressLabel(r: TaskRecurrenceDto): string {
    if (r.totalCount !== null) return `${r.lastOccurrenceNo} of ${r.totalCount}`;
    return `${r.lastOccurrenceNo} created`;
}

export default function RecurringTaskList({
    positions,
    canManage,
}: {
    positions: TaskPositionOption[];
    canManage: boolean;
}) {
    const [rows, setRows] = useState<TaskRecurrenceDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<TaskRecurrenceDto | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await axios.get<TaskRecurrenceDto[]>("/api/admin-task-recurrences");
            setRows(res.data);
        } catch {
            toast.error("Failed to load recurring tasks");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const { remove, deleting } = useDeleteWithConfirm<TaskRecurrenceDto>({
        url: (id) => `/api/admin-task-recurrences/${id}`,
        message: (r) =>
            `Stop the recurring task "${r?.title}"? The ${r?.generatedCount ?? 0} task(s) it already created will stay on the board.`,
        successMessage: "Recurring task removed",
        onSuccess: () => load(),
    });

    const togglePaused = async (r: TaskRecurrenceDto, active: boolean) => {
        // Optimistic — the switch must feel instant.
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: active } : x)));
        try {
            await axios.patch(`/api/admin-task-recurrences/${r.id}`, { isActive: active });
            load();
        } catch (err) {
            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: !active } : x)));
            toast.error(extractApiError(err, "Failed to update"));
        }
    };

    const generateNow = async () => {
        setRunning(true);
        try {
            const res = await axios.post<{ generated: number }>("/api/admin-task-recurrences/run");
            const n = res.data.generated;
            toast.success(n === 0 ? "Nothing due right now" : `${n} task(s) created`);
            load();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to generate tasks"));
        } finally {
            setRunning(false);
        }
    };

    const openCreate = () => {
        setEditing(null);
        setFormOpen(true);
    };
    const openEdit = (r: TaskRecurrenceDto) => {
        setEditing(r);
        setFormOpen(true);
    };

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Repeat className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold leading-none tracking-tight">Recurring Tasks</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Instalments, rent, renewals — one definition, the tasks appear on the
                            Work Board on their own.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" onClick={load} title="Refresh">
                        <RefreshCw className="size-4" />
                    </Button>
                    {canManage && (
                        <>
                            <Button variant="outline" onClick={generateNow} disabled={running}>
                                <Play className="size-4" /> Generate now
                            </Button>
                            <Button onClick={openCreate}>
                                <Plus className="size-4" /> New recurring task
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-dashed p-10 text-center">
                    <Repeat className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No recurring tasks yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Add one for the shop rent or a loan instalment, and it will keep creating
                        the task for you.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 font-medium">Task</th>
                                <th className="px-3 py-2 font-medium">Repeats</th>
                                <th className="px-3 py-2 font-medium">Progress</th>
                                <th className="px-3 py-2 font-medium">Next due</th>
                                <th className="px-3 py-2 font-medium">Amount</th>
                                <th className="px-3 py-2 font-medium">Assigned to</th>
                                <th className="px-3 py-2 font-medium">Active</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const priority = PRIORITY_META[r.priority] ?? PRIORITY_META.MEDIUM;
                                const finished = r.endedAt !== null;
                                return (
                                    <tr key={r.id} className={`border-t ${finished ? "opacity-60" : ""}`}>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{r.title}</span>
                                                <Badge className={priority.color}>{priority.label}</Badge>
                                            </div>
                                            {r.category && (
                                                <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                    {r.category}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">{repeatLabel(r)}</td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            {progressLabel(r)}
                                            {finished && (
                                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                                                    Completed
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                            {r.nextDueAt ? formatDate(r.nextDueAt) : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            {r.amountPaise != null ? formatRupeesFromPaise(r.amountPaise) : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-muted-foreground">
                                            {r.assignedPosition?.title ?? <span className="italic">Unassigned</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <Switch
                                                checked={r.isActive}
                                                disabled={!canManage || finished}
                                                onCheckedChange={(v) => togglePaused(r, v)}
                                            />
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {canManage && (
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        title="Edit"
                                                        onClick={() => openEdit(r)}
                                                    >
                                                        <Pencil className="size-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        title="Remove"
                                                        disabled={deleting}
                                                        onClick={() => remove(r.id, r)}
                                                    >
                                                        <Trash2 className="size-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <RecurringTaskFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                positions={positions}
                recurrence={editing}
                onSaved={load}
            />
        </div>
    );
}
