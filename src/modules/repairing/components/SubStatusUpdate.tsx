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
    groupId: string | null;
    notifyRoles: string[];
    triggerStatus: { id: string; label: string } | null;
}

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
    const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: { subStatusId: "", note: "" },
    });

    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    const selectedId = watch("subStatusId");

    useEffect(() => {
        Promise.all([
            axios.get(`/api/sub-statuses?statusId=${ticket.status}`),
            axios.get("/api/sub-status-groups"),
        ]).then(([ssRes, grRes]) => {
            setSubStatuses(ssRes.data);
            const map: Record<string, string> = {};
            for (const g of grRes.data) map[g.id] = g.label;
            setGroupLabels(map);
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

    const userRoles: string[] = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];

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
                            <label className="flex items-center gap-2 border-2 border-border px-3 py-2 text-sm cursor-pointer">
                                <input
                                    type="radio"
                                    {...register("subStatusId")}
                                    value=""
                                    className="accent-primary"
                                />
                                <span className="text-muted-foreground">— Clear sub-status —</span>
                            </label>

                            {Object.entries(grouped).map(([groupKey, items]) => (
                                <div key={groupKey}>
                                    <p className="px-1 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        {groupLabels[groupKey] ?? groupKey}
                                    </p>
                                    {items.map((ss) => {
                                        const canSet = ss.notifyRoles.length === 0 || ss.notifyRoles.some(r => userRoles.includes(r));
                                        return (
                                            <label
                                                key={ss.id}
                                                className={`flex items-center gap-2 border-2 border-border px-3 py-2 text-sm cursor-pointer ${!canSet ? "opacity-50 cursor-not-allowed" : ""}`}
                                            >
                                                <input
                                                    type="radio"
                                                    {...register("subStatusId")}
                                                    value={ss.id}
                                                    disabled={!canSet}
                                                    className="accent-primary"
                                                />
                                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${ss.color}`}>{ss.label}</span>
                                                {ss.triggerStatus && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <ArrowRight size={12} /> {ss.triggerStatus.label}
                                                    </span>
                                                )}
                                                {ss.notifyRoles.length > 0 && (
                                                    <span className="ml-auto text-xs text-muted-foreground">
                                                        {ss.notifyRoles.map(r => ROLE_LABELS[r] ?? r).join(", ")}
                                                    </span>
                                                )}
                                            </label>
                                        );
                                    })}
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
