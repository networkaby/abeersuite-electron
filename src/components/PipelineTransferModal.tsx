"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRightLeft, X } from "lucide-react";

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

const fieldClass = "w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="border-2 border-border shadow bg-card w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="font-semibold text-foreground flex items-center gap-2">
                        <ArrowRightLeft size={17} />
                        Transfer to Another Pipeline
                    </h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X size={18} />
                    </button>
                </div>

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading pipelines…</p>
                ) : pipelines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No other active pipelines available.</p>
                ) : (
                    <div className="space-y-4">
                        {currentPipelineLabel && (
                            <div className="text-xs text-muted-foreground border-2 border-border bg-muted px-3 py-2">
                                Currently in: <span className="font-medium text-foreground">{currentPipelineLabel}</span>
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                                Transfer To
                            </label>
                            <div className="grid grid-cols-1 gap-2">
                                {pipelines.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handlePipelineChange(p.id)}
                                        className={`flex items-center gap-3 px-4 py-3 border-2 text-left transition-colors ${
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
                                    </button>
                                ))}
                            </div>
                        </div>

                        {selectedPipeline && selectedPipeline.statuses.length > 0 && (
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                                    Land On Stage
                                </label>
                                <select
                                    value={selectedStatusId}
                                    onChange={e => setSelectedStatusId(e.target.value)}
                                    className={fieldClass}
                                >
                                    {selectedPipeline.statuses.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.label}{s.isEntryPoint ? " ★" : ""}
                                        </option>
                                    ))}
                                </select>
                                {selectedPipeline.statuses.some(s => s.isEntryPoint) && (
                                    <p className="text-xs text-muted-foreground mt-1">★ = default entry point</p>
                                )}
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                                Reason / Note <span className="font-normal normal-case">(optional)</span>
                            </label>
                            <textarea
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={2}
                                placeholder="e.g. Repair is more complex than expected"
                                className="w-full resize-none border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>

                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={onClose}
                                className="flex-1 border-2 border-border py-2 text-sm hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || !selectedStatusId}
                                className="flex-1 border-2 border-primary bg-primary py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                                {submitting ? "Transferring…" : "Transfer Ticket"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
