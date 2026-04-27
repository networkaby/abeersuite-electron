"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";
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
    notifyRoles: string[];
    triggerStatus: { id: string; label: string } | null;
}

const GROUP_LABELS: Record<string, string> = {
    customer_comm: "Customer Communication",
    approval: "Quote & Approval",
    parts: "Parts",
    qc: "Quality Check",
    escalated: "Escalated",
    ready: "Ready for Collection",
    no_fix: "No Fix",
};

const ROLE_LABELS: Record<string, string> = {
    R1: "Admin", R2: "Technician", R3: "Front Desk", R4: "Despatch",
};

interface Props {
    ticket: { id: number; status: string };
    onClose: () => void;
}

type FormData = { subStatusId: string; note: string };

export default function SubStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [loading, setLoading] = useState(true);

    const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: { subStatusId: "", note: "" },
    });

    const selectedId = watch("subStatusId");
    const selected = subStatuses.find((ss) => ss.id === selectedId);

    useEffect(() => {
        axios
            .get(`/api/sub-statuses?statusId=${ticket.status}`)
            .then((r) => setSubStatuses(r.data))
            .catch(() => toast.error("Failed to load sub-statuses"))
            .finally(() => setLoading(false));
    }, [ticket.status]);

    const onSubmit = async (data: FormData) => {
        if (!data.subStatusId) { toast.error("Please select a sub-status"); return; }
        try {
            await axios.patch(`/api/tickets/${ticket.id}/sub-status`, {
                subStatusId: data.subStatusId,
                note: data.note || undefined,
                changedBy: session?.user?.id,
            });
            toast.success("Sub-status updated");
            onClose();
        } catch {
            toast.error("Failed to update sub-status");
        }
    };

    const grouped = subStatuses.reduce<Record<string, SubStatus[]>>((acc, ss) => {
        (acc[ss.group] ??= []).push(ss);
        return acc;
    }, {});

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Update Sub-Status</DialogTitle>
                    <DialogDescription>Add detail or trigger a handoff</DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading...</p>
                ) : subStatuses.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No sub-statuses available for this status.</p>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="space-y-3">
                            {Object.entries(grouped).map(([group, items]) => (
                                <div key={group}>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                        {GROUP_LABELS[group] ?? group}
                                    </p>
                                    <div className="space-y-1">
                                        {items.map((ss) => (
                                            <label
                                                key={ss.id}
                                                className={`flex items-center gap-3 px-3 py-2 border-2 cursor-pointer transition-colors ${
                                                    selectedId === ss.id
                                                        ? "border-primary bg-primary/10"
                                                        : "border-border hover:bg-muted"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    value={ss.id}
                                                    {...register("subStatusId")}
                                                    className="accent-primary"
                                                />
                                                <div className="flex-1">
                                                    <span className="text-sm text-foreground">{ss.label}</span>
                                                    {ss.triggerStatus && (
                                                        <span className="ml-2 text-xs text-primary font-medium">
                                                            → {ss.triggerStatus.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className={`text-xs px-2 py-0.5 ${ss.color}`}>{ss.id}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {selected && selected.notifyRoles.length > 0 && (
                            <div className="border-2 border-primary bg-primary/10 px-3 py-2 flex items-center gap-2 text-sm text-primary">
                                <ArrowRight size={14} />
                                Notifies: {selected.notifyRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                            </div>
                        )}

                        {selected?.triggerStatus && (
                            <div className="border-2 border-border bg-muted px-3 py-2 text-sm text-foreground">
                                Status will auto-advance to <strong>{selected.triggerStatus.label}</strong>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea
                                {...register("note")}
                                rows={3}
                                placeholder="Add context — missing item, part number, customer quote, etc."
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                            <Button type="submit" disabled={isSubmitting || !selectedId}>
                                {isSubmitting ? "Saving..." : "Update Sub-Status"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
