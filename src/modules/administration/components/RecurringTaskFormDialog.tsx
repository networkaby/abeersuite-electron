"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { toDateTimeLocalInput, rupeesToPaise, paiseToRupees } from "@/shared/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/shared/components/NumericInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";
import { PRIORITY_META } from "@/utils/constants";
import type { TaskPriority, TaskPositionOption, TaskRecurrenceDto, RecurrenceUnit } from "../lib/types";

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const UNASSIGNED = "__none__";

/** Calendar units a task can repeat by. Minute/hour stay worker-retry-only. */
const UNITS: { key: RecurrenceUnit; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
];

export default function RecurringTaskFormDialog({
    open,
    onOpenChange,
    positions,
    recurrence,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    positions: TaskPositionOption[];
    /** When set, the dialog edits this recurrence; otherwise it creates a new one. */
    recurrence?: TaskRecurrenceDto | null;
    onSaved: () => void;
}) {
    const isEdit = Boolean(recurrence);
    // The schedule is frozen once tasks have been generated — changing it would
    // silently reinterpret which month was "#3". The server rejects it too.
    const scheduleLocked = (recurrence?.lastOccurrenceNo ?? 0) > 0;

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
    const [assignedPositionId, setAssignedPositionId] = useState<string>(UNASSIGNED);
    const [unit, setUnit] = useState<RecurrenceUnit>("month");
    const [every, setEvery] = useState("1");
    const [totalCount, setTotalCount] = useState("");
    const [anchorAt, setAnchorAt] = useState("");
    const [leadDays, setLeadDays] = useState("0");
    const [amount, setAmount] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle(recurrence?.title ?? "");
        setDescription(recurrence?.description ?? "");
        setCategory(recurrence?.category ?? "");
        setPriority(recurrence?.priority ?? "MEDIUM");
        setAssignedPositionId(recurrence?.assignedPositionId ?? UNASSIGNED);
        setUnit(recurrence?.unit ?? "month");
        setEvery(String(recurrence?.every ?? 1));
        setTotalCount(recurrence?.totalCount != null ? String(recurrence.totalCount) : "");
        setAnchorAt(toDateTimeLocalInput(recurrence?.anchorAt ?? null));
        setLeadDays(String(recurrence?.leadDays ?? 0));
        setAmount(recurrence?.amountPaise != null ? String(paiseToRupees(recurrence.amountPaise)) : "");
    }, [open, recurrence]);

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error("Title is required");
            return;
        }
        if (!anchorAt) {
            toast.error("First due date is required");
            return;
        }
        setSaving(true);
        const rupees = Number(amount);
        const payload = {
            title: title.trim(),
            description: description.trim() || null,
            category: category.trim() || null,
            priority,
            assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
            unit,
            every: Number(every) || 1,
            totalCount: totalCount.trim() ? Number(totalCount) : null,
            anchorAt,
            leadDays: Number(leadDays) || 0,
            amountPaise: amount.trim() && !Number.isNaN(rupees) ? rupeesToPaise(rupees) : null,
        };
        try {
            if (isEdit && recurrence) {
                await axios.patch(`/api/admin-task-recurrences/${recurrence.id}`, payload);
                toast.success("Recurring task updated");
            } else {
                await axios.post("/api/admin-task-recurrences", payload);
                toast.success("Recurring task created");
            }
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save recurring task"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit recurring task" : "New recurring task"}</DialogTitle>
                    <DialogDescription>
                        One definition creates the task again and again — an EMI instalment,
                        monthly rent, a licence renewal.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 md:grid-cols-[1fr_260px]">
                    {/* ── Main fields ─────────────────────────────────────────── */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rec-title">Title</Label>
                            <Input
                                id="rec-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Shop rent · Shop loan EMI"
                            />
                            <p className="text-xs text-muted-foreground">
                                Each generated task adds the occurrence — &ldquo;#3 of 12&rdquo; for a fixed
                                count, or the month for an ongoing one.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="rec-desc">Description</Label>
                            <Textarea
                                id="rec-desc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Details, account number, contact…"
                                rows={2}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="rec-category">Category</Label>
                                <Input
                                    id="rec-category"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    placeholder="Finance, Rent…"
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
                                <Label htmlFor="rec-amount">Amount (₹)</Label>
                                <NumericInput
                                    id="rec-amount"
                                    mode="decimal"
                                    min={0}
                                    value={amount}
                                    onValueChange={setAmount}
                                    placeholder="Optional"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Amount is for your reference only — shown on the task, never posted to
                            the accounts.
                        </p>
                    </div>

                    {/* ── Repeats (aside) ─────────────────────────────────────── */}
                    <div className="space-y-4 rounded-lg border bg-muted/30 p-3 self-start">
                        <p className="text-sm font-medium">Repeats</p>

                        {scheduleLocked && (
                            <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                Tasks are already generated, so the repeat schedule is locked. Stop this
                                one and create a new recurring task if the schedule must change.
                            </p>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="rec-every">Repeat every</Label>
                            <div className="flex gap-2">
                                <NumericInput
                                    id="rec-every"
                                    min={1}
                                    className="w-16"
                                    value={every}
                                    disabled={scheduleLocked}
                                    onValueChange={setEvery}
                                />
                                <Select
                                    value={unit}
                                    onValueChange={(v) => setUnit(v as RecurrenceUnit)}
                                    disabled={scheduleLocked}
                                >
                                    <SelectTrigger className="flex-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {UNITS.map((u) => (
                                            <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="rec-count">Occurrences</Label>
                            <NumericInput
                                id="rec-count"
                                min={1}
                                value={totalCount}
                                onValueChange={setTotalCount}
                                placeholder="Blank = no end"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>First due</Label>
                            <TallyDateTimeInput
                                value={anchorAt}
                                onValueChange={setAnchorAt}
                                disabled={scheduleLocked}
                            />
                            <p className="text-xs text-muted-foreground">
                                Its day of the month is the rule — the 31st becomes the 30th in a
                                short month, then comes back to the 31st.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="rec-lead">Create in advance</Label>
                            <div className="flex items-center gap-2">
                                <NumericInput
                                    id="rec-lead"
                                    min={0}
                                    className="w-16"
                                    value={leadDays}
                                    onValueChange={setLeadDays}
                                />
                                <span className="text-sm text-muted-foreground">days before</span>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !title.trim() || !anchorAt}>
                        {isEdit ? "Save changes" : "Create recurring task"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
