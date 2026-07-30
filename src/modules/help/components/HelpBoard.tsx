"use client";

import { useState } from "react";
import HelpCard from "./HelpCard";
import type { HelpDto, HelpStage } from "../lib/types";

export default function HelpBoard({
    stages,
    tickets,
    canEdit,
    loading,
    onMove,
    onOpen,
}: {
    stages: HelpStage[];
    tickets: HelpDto[];
    canEdit: boolean;
    loading: boolean;
    onMove: (ticketId: number, stageId: string) => void;
    onOpen: (ticketId: number) => void;
}) {
    const [draggedId, setDraggedId] = useState<number | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);

    const byStage = (stageId: string) => tickets.filter((t) => t.status === stageId);

    const handleDrop = (stageId: string) => {
        setDragOverStage(null);
        const id = draggedId;
        setDraggedId(null);
        if (id === null) return;
        const ticket = tickets.find((t) => t.id === id);
        if (!ticket || ticket.status === stageId) return;
        onMove(id, stageId);
    };

    return (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {stages.map((stage) => {
                const items = byStage(stage.id);
                const isOver = dragOverStage === stage.id;
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
                        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                            {loading ? (
                                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                            ) : items.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground">
                                    No tickets
                                </div>
                            ) : (
                                items.map((ticket) => (
                                    <HelpCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        draggable={canEdit}
                                        onDragStart={() => setDraggedId(ticket.id)}
                                        onClick={() => onOpen(ticket.id)}
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
