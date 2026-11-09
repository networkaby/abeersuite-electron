"use client";

import { useColumnCap } from "@/shared/hooks/useColumnCap";
import ColumnShowMore from "@/shared/components/ColumnShowMore";

import { useState } from "react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import DealCard from "./DealCard";
import type { DealDto, DealStage } from "../lib/types";

export default function DealBoard({
    stages,
    deals,
    canEdit,
    loading,
    onMove,
    onOpen,
}: {
    stages: DealStage[];
    deals: DealDto[];
    canEdit: boolean;
    loading: boolean;
    onMove: (dealId: number, stageId: string) => void;
    onOpen: (dealId: number) => void;
}) {
    const cap = useColumnCap();
    const [draggedId, setDraggedId] = useState<number | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);

    const byStage = (stageId: string) => deals.filter((l) => l.status === stageId);
    const stageValue = (stageId: string) =>
        byStage(stageId).reduce((sum, l) => sum + (l.valuePaise ?? 0), 0);

    const handleDrop = (stageId: string) => {
        setDragOverStage(null);
        const id = draggedId;
        setDraggedId(null);
        if (id === null) return;
        const deal = deals.find((l) => l.id === id);
        if (!deal || deal.status === stageId) return;
        onMove(id, stageId);
    };

    return (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {stages.map((stage) => {
                const items = byStage(stage.id);
                const page = cap(stage.id, items);
                const isOver = dragOverStage === stage.id;
                const total = stageValue(stage.id);
                return (
                    <div
                        key={stage.id}
                        onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); setDragOverStage(stage.id); }}
                        onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                        onDrop={() => canEdit && handleDrop(stage.id)}
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
                            {loading && deals.length === 0 ? (
                                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                            ) : items.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground">
                                    No deals
                                </div>
                            ) : (
                                <>{page.shown.map((deal) => (
                                    <DealCard
                                        key={deal.id}
                                        deal={deal}
                                        draggable={canEdit}
                                        onDragStart={() => setDraggedId(deal.id)}
                                        onClick={() => onOpen(deal.id)}
                                    />
                                ))}
                                <ColumnShowMore hidden={page.hidden} onClick={page.showMore} /></>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
