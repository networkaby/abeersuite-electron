"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface SubStatus {
    id: string;
    label: string;
    color: string;
    group: string;
    groupId: string | null;
    triggerStatus: { id: string; label: string } | null;
}


interface Props {
    ticket: { id: number; status: string };
    onClose: () => void;
}

type FormData = { subStatusId: string; note: string };

export default function SubStatusUpdate({ ticket, onClose }: Props) {
    const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: { subStatusId: "", note: "" },
    });

    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    // eslint-disable-next-line react-hooks/incompatible-library
    const selectedId = watch("subStatusId");

    useEffect(() => {
        Promise.all([
            axios.get(`/api/sub-statuses?statusId=${ticket.status}`),
            axios.get("/api/sub-status-groups"),
        ]).then(([ssRes, grRes]) => {
            setSubStatuses(ssRes.data);
            const groupMap: Record<string, string> = {};
            for (const g of grRes.data) groupMap[g.id] = g.label;
            setGroupLabels(groupMap);
        }).catch(() => {
            toast.error("Failed to load sub-statuses");
        }).finally(() => setLoading(false));
    }, [ticket.status]);

    const grouped = subStatuses.reduce<Record<string, SubStatus[]>>((acc, ss) => {
        const key = ss.groupId ?? ss.group ?? "__none__";
        if (!acc[key]) acc[key] = [];
        acc[key].push(ss);
        return acc;
    }, {});

    const onSubmit = async (data: FormData) => {
        try {
            await axios.post(`/api/tickets/${ticket.id}/sub-status`, {
                subStatusId: data.subStatusId || null,
                note: data.note,
            });
            toast.success("Sub-status updated");
            onClose();
        } catch {
            toast.error("Failed to update sub-status");
        }
    };

    const selected = subStatuses.find((ss) => ss.id === selectedId);

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Update Sub-Status</DialogTitle>
                    <DialogDescription>Choose the current work stage for this ticket.</DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setValue("subStatusId", "")}
                                className={`h-auto w-full justify-start gap-2 px-3 py-2 text-sm ${
                                    selectedId === "" ? "border-primary bg-primary/10 hover:bg-primary/10" : ""
                                }`}
                            >
                                <span className="text-muted-foreground">— Clear sub-status —</span>
                            </Button>

                            {Object.entries(grouped).map(([groupKey, items]) => (
                                <div key={groupKey}>
                                    <p className="px-1 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        {groupLabels[groupKey] ?? groupKey}
                                    </p>
                                    {items.map((ss) => (
                                        <Button
                                            key={ss.id}
                                            type="button"
                                            variant="outline"
                                            onClick={() => setValue("subStatusId", ss.id)}
                                            className={`h-auto w-full justify-start gap-2 px-3 py-2 text-sm ${
                                                selectedId === ss.id ? "border-primary bg-primary/10 hover:bg-primary/10" : ""
                                            }`}
                                        >
                                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${ss.color}`}>{ss.label}</span>
                                            {ss.triggerStatus && (
                                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <ArrowRight size={12} /> {ss.triggerStatus.label}
                                                </span>
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            ))}
                        </div>

                        {selected?.triggerStatus && (
                            <p className="text-xs text-amber-600">
                                Selecting this will advance the ticket to <strong>{selected.triggerStatus.label}</strong>.
                            </p>
                        )}

                        <div className="space-y-1">
                            <Label htmlFor="note">Note (optional)</Label>
                            <Textarea id="note" {...register("note")} placeholder="Add a note…" rows={3} />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Saving…" : "Save"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
