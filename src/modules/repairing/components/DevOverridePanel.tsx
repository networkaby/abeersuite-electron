"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useValueChange } from "@/shared/hooks/useValueChange";

interface Opt { id: string; label: string }
interface WorkerOpt extends Opt { statusId: string | null }

interface Props {
    ticketId: number;
    pipelineId?: string | null;
    currentStatusId: string;
    currentWorkerId: string | null;
    onChanged: () => void;
}

// Sentinel for "no worker" — Radix Select can't hold an empty-string value.
const NONE = "__none__";

/**
 * DEV / admin-only escape hatch. Drops the ticket onto any (status, worker) pair
 * in its pipeline with NO routing — bypasses triggerMap, entry workers, retry
 * schedules and autoAdvance. For unsticking a ticket whose status/worker movement
 * is stuck (no configured route out). Gated by the caller on admin:bypass /
 * settings:manage. Mirrors the dev "Ticket context" panel styling.
 */
export default function DevOverridePanel({ ticketId, pipelineId, currentStatusId, currentWorkerId, onChanged }: Props) {
    const [statuses, setStatuses] = useState<Opt[]>([]);
    const [workers, setWorkers] = useState<WorkerOpt[]>([]);
    const [statusId, setStatusId] = useState(currentStatusId);
    const [workerId, setWorkerId] = useState(currentWorkerId ?? NONE);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        const q = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : "";
        return Promise.all([
            axios.get(`/api/ticket-statuses${q}`),
            axios.get(`/api/workers${q}`),
        ])
            .then(([st, wk]) => {
                setStatuses((st.data as Opt[]).map((s) => ({ id: s.id, label: s.label })));
                setWorkers((wk.data as WorkerOpt[]).map((w) => ({ id: w.id, label: w.label, statusId: w.statusId ?? null })));
            })
            .catch(() => { toast.error("Failed to load pipeline statuses / workers"); });
    }, [pipelineId]);

    useEffect(() => { load(); }, [load]);

    // The status and worker option lists are workflow config; a stage added
    // elsewhere should be selectable here without a reload. The two selects
    // below hold the user's pick and are left alone.
    useRealtimeTopics(["tickets"], () => { load(); });
    // Re-sync the selects when the ticket reloads after an apply (while rendering).
    if (useValueChange(currentStatusId)) setStatusId(currentStatusId);
    if (useValueChange(currentWorkerId)) setWorkerId(currentWorkerId ?? NONE);

    // Only the workers that belong to the selected status — a worker lives in one
    // status, so showing the whole pipeline is noise (and lets you pick an invalid pair).
    const visibleWorkers = workers.filter((w) => w.statusId === statusId);
    // If the selected worker isn't valid for the chosen status, drop back to "no worker".
    // Re-checked only when the status or the worker list changes — while rendering.
    const recheckWorker = [useValueChange(statusId), useValueChange(workers)].some(Boolean);
    if (recheckWorker && workerId !== NONE && !visibleWorkers.some((w) => w.id === workerId)) setWorkerId(NONE);

    const dirty = statusId !== currentStatusId || (workerId === NONE ? null : workerId) !== currentWorkerId;

    const apply = async () => {
        setBusy(true);
        try {
            await axios.patch(`/api/tickets/${ticketId}/override`, {
                status: statusId,
                workerId: workerId === NONE ? null : workerId,
            });
            toast.success("Ticket overridden");
            onChanged();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Override failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-2.5 rounded-lg border border-dashed border-amber-400/70 bg-amber-50/50 p-4 dark:border-amber-700/60 dark:bg-amber-950/20">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                <Wrench size={14} /> Force status / worker
                <span className="ml-auto rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">dev</span>
            </h2>
            <p className="text-[11px] leading-tight text-muted-foreground">
                Raw move — skips all routing. Use to unstick a ticket with no configured way out.
            </p>

            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Status</label>
                <Select value={statusId} onValueChange={setStatusId}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        {statuses.map((s) => <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Worker</label>
                <Select value={workerId} onValueChange={setWorkerId}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs"><SelectValue placeholder="Worker" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE} className="text-xs text-muted-foreground">— No worker —</SelectItem>
                        {visibleWorkers.length === 0
                            ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No workers in this status</div>
                            : visibleWorkers.map((w) => <SelectItem key={w.id} value={w.id} className="text-xs">{w.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <Button onClick={apply} disabled={busy || !dirty} size="sm" className="w-full">
                {busy ? "Applying…" : "Apply override"}
            </Button>
        </div>
    );
}
