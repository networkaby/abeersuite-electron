"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X, ChevronRight, Lock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NextMainStatus { id: string; label: string; }
interface NextSubStatus {
    id: string; label: string; color: string;
    triggerMap: Record<string, string>;
}


interface Props {
    ticket: {
        id: number; status: string; subStatusId?: string | null;
        pipelineId?: string | null; isWarranty?: boolean;
        ticketStatus: { label: string; fromTransitions: { to: NextMainStatus }[]; };
        ticketSubStatus?: { id: string; label: string; color: string } | null;
    };
    onClose: () => void;
}

type FormData = {
    mode: "substatus" | "mainstatus";
    subStatusId: string; mainStatusId: string;
    note: string; visibility: "INTERNAL" | "PUBLIC";
};

export default function StatusUpdateCombined({ ticket, onClose }: Props) {
    const [nextSubStatuses, setNextSubStatuses] = useState<NextSubStatus[]>([]);
    const [loadingSubStatuses, setLoadingSubStatuses] = useState(true);
    const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});

    const nextMainStatuses: NextMainStatus[] = ticket.ticketStatus.fromTransitions.map((t) => t.to);

    const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: {
            mode: "substatus", subStatusId: "",
            mainStatusId: nextMainStatuses[0]?.id ?? "",
            note: "", visibility: "INTERNAL",
        },
    });

    const mode = watch("mode");
    const selectedSubId = watch("subStatusId");
    const selectedMainId = watch("mainStatusId");
    const visibility = watch("visibility");
    const selectedSub = nextSubStatuses.find((ss) => ss.id === selectedSubId);
    const selectedMain = nextMainStatuses.find((s) => s.id === selectedMainId);

    useEffect(() => {
        const currentSubId = ticket.subStatusId ?? null;
        const params = new URLSearchParams({ statusId: ticket.status });
        if (currentSubId) params.set("fromSubStatusId", currentSubId);
        else params.set("entryOnly", "true");
        if (ticket.isWarranty) params.set("isWarranty", "true");
        const statusParams = ticket.pipelineId ? `?pipelineId=${ticket.pipelineId}` : "";
        Promise.all([
            axios.get(`/api/sub-statuses/next?${params}`),
            axios.get(`/api/ticket-statuses${statusParams}`),
        ])
            .then(([subRes, statusRes]) => {
                setNextSubStatuses(subRes.data);
                const labels: Record<string, string> = {};
                for (const s of statusRes.data as { id: string; label: string }[]) labels[s.id] = s.label;
                setStatusLabels(labels);
                if (subRes.data.length === 0 && nextMainStatuses.length > 0) setValue("mode", "mainstatus");
            })
            .catch(() => toast.error("Failed to load statuses"))
            .finally(() => setLoadingSubStatuses(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticket.status, ticket.subStatusId]);

    const onSubmit = async (data: FormData) => {
        try {
            if (data.mode === "substatus") {
                if (!data.subStatusId) { toast.error("Select a sub-status"); return; }
                await axios.patch(`/api/tickets/${ticket.id}/sub-status`, {
                    subStatusId: data.subStatusId, note: data.note || undefined, visibility: data.visibility,
                });
            } else {
                if (!data.mainStatusId) { toast.error("Select a status"); return; }
                await axios.put(`/api/tickets/${ticket.id}`, {
                    status: data.mainStatusId, logNote: data.note || undefined, visibility: data.visibility,
                });
            }
            toast.success("Status updated");
            onClose();
        } catch { toast.error("Failed to update status"); }
    };

    const isTerminalReopen = ticket.status === "S7" || ticket.status === "S8";

    const visibilityBtn = (v: "INTERNAL" | "PUBLIC") => `flex h-auto items-center gap-1.5 flex-1 px-2 py-1.5 border text-xs font-medium transition-colors ${
        visibility === v
            ? v === "INTERNAL" ? "border-border bg-muted text-foreground" : "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-muted"
    }`;

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                <DialogHeader className="mb-1 flex-row items-center justify-between space-y-0">
                    <div>
                        <DialogTitle>Update Status</DialogTitle>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs px-2 py-0.5 font-medium bg-muted text-muted-foreground">
                                {ticket.ticketStatus.label}
                            </span>
                            {ticket.ticketSubStatus && (
                                <>
                                    <ChevronRight size={12} className="text-muted-foreground" />
                                    <span className={`text-xs px-2 py-0.5 font-medium ${ticket.ticketSubStatus.color}`}>
                                        {ticket.ticketSubStatus.label}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground"><X size={20} /></Button>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {!isTerminalReopen && (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <Button type="button" onClick={() => setValue("mode", "substatus")} variant={mode === "substatus" ? "default" : "outline"}
                                className="w-full">
                                Within this stage
                            </Button>
                            <Button type="button" onClick={() => setValue("mode", "mainstatus")} variant={mode === "mainstatus" ? "default" : "outline"}
                                className="w-full">
                                Advance stage
                            </Button>
                        </div>
                    )}

                    {mode === "substatus" && !isTerminalReopen && (
                        <div>
                            {loadingSubStatuses ? (
                                <p className="text-sm text-muted-foreground">Loading...</p>
                            ) : nextSubStatuses.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-2">
                                    No further sub-status steps available. Use &ldquo;Advance stage&rdquo; to move to the next main status.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {nextSubStatuses.map((ss) => (
                                        <Button
                                            key={ss.id}
                                            type="button"
                                            variant="outline"
                                            onClick={() => setValue("subStatusId", ss.id)}
                                            className={`h-auto w-full justify-start gap-3 px-3 py-2.5 transition-colors ${
                                                selectedSubId === ss.id ? "border-primary bg-primary/10 hover:bg-primary/10" : ""
                                            }`}
                                        >
                                            <div className="flex-1">
                                                <span className="text-sm text-foreground">{ss.label}</span>
                                                {ss.triggerMap[ticket.status] && (
                                                    <span className="ml-2 text-xs text-primary font-medium">
                                                        → {statusLabels[ss.triggerMap[ticket.status]] ?? ss.triggerMap[ticket.status]}
                                                    </span>
                                                )}
                                            </div>
                                            <span className={`text-xs px-2 py-0.5 shrink-0 ${ss.color}`}>{ss.id}</span>
                                        </Button>
                                    ))}
                                </div>
                            )}
                            {selectedSub?.triggerMap[ticket.status] && (
                                <div className="mt-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                                    Stage will auto-advance to <strong>{statusLabels[selectedSub.triggerMap[ticket.status]] ?? selectedSub.triggerMap[ticket.status]}</strong>
                                </div>
                            )}
                        </div>
                    )}

                    {(mode === "mainstatus" || isTerminalReopen) && (
                        <div>
                            {isTerminalReopen && (
                                <div className="mb-3 rounded-md border border-primary bg-primary/10 p-3 text-sm text-primary">
                                    ↩ This will reopen the ticket and start a new repair cycle.
                                </div>
                            )}
                            {nextMainStatuses.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-2">No further stages available.</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {nextMainStatuses.map((s) => (
                                        <Button
                                            key={s.id}
                                            type="button"
                                            variant="outline"
                                            onClick={() => setValue("mainStatusId", s.id)}
                                            className={`h-auto w-full justify-start gap-3 px-3 py-2.5 transition-colors ${
                                                selectedMainId === s.id ? "border-primary bg-primary/10 hover:bg-primary/10" : ""
                                            }`}
                                        >
                                            <span className="text-sm text-foreground">{s.label}</span>
                                        </Button>
                                    ))}
                                </div>
                            )}
                            {selectedMain && (
                                <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                                    Moving to <strong>{selectedMain.label}</strong> will clear the current sub-status.
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="block text-sm font-medium">
                            Note <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Textarea {...register("note")} rows={2}
                            placeholder="Add context — part number, customer quote, courier details..."
                            className="resize-none"
                        />
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={() => setValue("visibility", "INTERNAL")} className={visibilityBtn("INTERNAL")}>
                                <Lock size={11} /> Internal
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setValue("visibility", "PUBLIC")} className={visibilityBtn("PUBLIC")}>
                                <Eye size={11} /> Public
                            </Button>
                        </div>
                    </div>

                    <DialogFooter className="pt-1">
                        <Button type="button" onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                        <Button type="submit" disabled={isSubmitting} className="flex-1">
                            {isSubmitting ? "Saving..." : isTerminalReopen ? "↩ Reopen Ticket" : "Update Status"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
