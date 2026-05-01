"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRightLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface PipelineOption {
    id: string;
    label: string;
    color: string;
    statuses: { id: string; label: string; isEntryPoint: boolean }[];
}

interface Props {
    ticketId: number;
    currentPipelineLabel?: string;
    onClose: () => void;
}

export default function PipelineTransferModal({ ticketId, currentPipelineLabel, onClose }: Props) {
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPipelineId, setSelectedPipelineId] = useState("");
    const [selectedStatusId, setSelectedStatusId] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        axios.get(`/api/tickets/${ticketId}/transfer`)
            .then(res => {
                setPipelines(res.data);
                if (res.data.length > 0) {
                    const first = res.data[0] as PipelineOption;
                    setSelectedPipelineId(first.id);
                    const entry = first.statuses.find(s => s.isEntryPoint) ?? first.statuses[0];
                    setSelectedStatusId(entry?.id ?? "");
                }
            })
            .catch(() => toast.error("Failed to load pipelines"))
            .finally(() => setLoading(false));
    }, [ticketId]);

    const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId);

    const handlePipelineChange = (pipelineId: string) => {
        setSelectedPipelineId(pipelineId);
        const pipeline = pipelines.find(p => p.id === pipelineId);
        const entry = pipeline?.statuses.find(s => s.isEntryPoint) ?? pipeline?.statuses[0];
        setSelectedStatusId(entry?.id ?? "");
    };

    const handleSubmit = async () => {
        if (!selectedPipelineId || !selectedStatusId) return;
        setSubmitting(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/transfer`, {
                targetPipelineId: selectedPipelineId,
                targetStatusId: selectedStatusId,
                note: note.trim() || undefined,
            });
            toast.success("Ticket transferred successfully");
            onClose();
        } catch (err: unknown) {
            const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
            toast.error(message ?? "Failed to transfer ticket");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="mb-1 flex-row items-center justify-between space-y-0">
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowRightLeft size={17} />
                        Transfer to Another Pipeline
                    </DialogTitle>
                    <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                        <X size={18} />
                    </Button>
                </DialogHeader>

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading pipelines…</p>
                ) : pipelines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No other active pipelines available.</p>
                ) : (
                    <div className="space-y-4">
                        {currentPipelineLabel && (
                            <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                                Currently in: <span className="font-medium text-foreground">{currentPipelineLabel}</span>
                            </div>
                        )}

                        <div>
                            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Transfer To
                            </Label>
                            <div className="grid grid-cols-1 gap-2">
                                {pipelines.map(p => (
                                    <Button
                                        key={p.id}
                                        onClick={() => handlePipelineChange(p.id)}
                                        variant="outline"
                                        className={`h-auto justify-start gap-3 px-4 py-3 text-left transition-colors ${
                                            selectedPipelineId === p.id
                                                ? "border-primary bg-primary/10"
                                                : "border-border hover:bg-muted"
                                        }`}
                                    >
                                        <span className={`px-2 py-0.5 text-xs font-medium ${p.color}`}>
                                            {p.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {p.statuses.length} stage{p.statuses.length !== 1 ? "s" : ""}
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {selectedPipeline && selectedPipeline.statuses.length > 0 && (
                            <div>
                                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    Land On Stage
                                </Label>
                                <Select value={selectedStatusId} onValueChange={setSelectedStatusId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select stage" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedPipeline.statuses.map(s => (
                                            <SelectItem key={s.id} value={s.id}>
                                                {s.label}{s.isEntryPoint ? " ★" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedPipeline.statuses.some(s => s.isEntryPoint) && (
                                    <p className="text-xs text-muted-foreground mt-1">★ = default entry point</p>
                                )}
                            </div>
                        )}

                        <div>
                            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Reason / Note <span className="font-normal normal-case">(optional)</span>
                            </Label>
                            <Textarea
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={2}
                                placeholder="e.g. Repair is more complex than expected"
                                className="resize-none"
                            />
                        </div>

                        <DialogFooter className="pt-1">
                            <Button
                                onClick={onClose}
                                variant="outline"
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={submitting || !selectedStatusId}
                                className="flex-1"
                            >
                                {submitting ? "Transferring…" : "Transfer Ticket"}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
