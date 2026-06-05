"use client";

import { useState } from "react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import LeadCard from "./LeadCard";
import type { LeadDto, LeadStage } from "../lib/types";

export default function LeadBoard({
    stages,
    leads,
    canManage,
    loading,
    onMove,
    onOpen,
}: {
    stages: LeadStage[];
    leads: LeadDto[];
    canManage: boolean;
    loading: boolean;
    onMove: (leadId: number, stageId: string) => void;
    onOpen: (leadId: number) => void;
}) {
    const [draggedId, setDraggedId] = useState<number | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);

    const byStage = (stageId: string) => leads.filter((l) => l.status === stageId);
    const stageValue = (stageId: string) =>
        byStage(stageId).reduce((sum, l) => sum + (l.valuePaise ?? 0), 0);

    const handleDrop = (stageId: string) => {
        setDragOverStage(null);
        const id = draggedId;
        setDraggedId(null);
        if (id === null) return;
        const lead = leads.find((l) => l.id === id);
        if (!lead || lead.status === stageId) return;
        onMove(id, stageId);
    };

    return (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {stages.map((stage) => {
                const items = byStage(stage.id);
                const isOver = dragOverStage === stage.id;
                const total = stageValue(stage.id);
                return (
                    <div
                        key={stage.id}
                        onDragOver={(e) => { if (!canManage) return; e.preventDefault(); setDragOverStage(stage.id); }}
                        onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                        onDrop={() => canManage && handleDrop(stage.id)}
                        className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors ${
                            isOver ? "border-primary/50 bg-primary/5 ring-2 ring-primary/30" : ""
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${stage.color}`}>{stage.label}</span>
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">
                                {items.length}
                            </span>
                        </div>
                        {total > 0 && (
                            <div className="px-3 pb-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                                {formatRupeesFromPaise(total)}
                            </div>
                        )}
                        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                            {loading ? (
                                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                            ) : items.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground">
                                    No leads
                                </div>
                            ) : (
                                items.map((lead) => (
                                    <LeadCard
                                        key={lead.id}
                                        lead={lead}
                                        draggable={canManage}
                                        onDragStart={() => setDraggedId(lead.id)}
                                        onClick={() => onOpen(lead.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
