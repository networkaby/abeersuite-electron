"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Stage { id: string; label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }
interface RefundCard { id: number; statusId: string | null; amount: number; reason: string | null; orderRef: string; customer: string | null; createdAt: string }

// O2C Refund sub-pipeline board (P9) — spawned when an order with a collected
// advance is rejected/cancelled. Drag to move its stage. Mirrors DeliveryBoard.
export function RefundBoard() {
    const [stages, setStages] = useState<Stage[]>([]);
    const [items, setItems] = useState<RefundCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragged, setDragged] = useState<RefundCard | null>(null);

    const load = useCallback(() => {
        axios.get<{ stages: Stage[]; refunds: RefundCard[] }>("/api/refunds")
            .then((r) => { setStages(r.data.stages); setItems(r.data.refunds); })
            .catch(() => toast.error("Failed to load refunds"))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);

    async function move(d: RefundCard, statusId: string) {
        if (d.statusId === statusId) return;
        const prev = items;
        setItems((arr) => arr.map((x) => (x.id === d.id ? { ...x, statusId } : x)));
        try {
            const { data } = await axios.patch<{ payoutRef?: string | null }>(`/api/refunds/${d.id}/status`, { statusId });
            if (data?.payoutRef) toast.success(`Refund paid — Payment ${data.payoutRef} posted`);
        } catch (e) {
            setItems(prev);
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : null;
            toast.error(msg || "That move isn't allowed");
        }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{items.length} refund{items.length !== 1 ? "s" : ""}</p>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}><RefreshCw size={14} /> Refresh</Button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4">
                {stages.map((stage) => {
                    const cards = items.filter((d) => d.statusId === stage.id);
                    return (
                        <div
                            key={stage.id}
                            className="w-72 shrink-0"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragged) void move(dragged, stage.id); setDragged(null); }}
                        >
                            <div className={`flex items-center justify-between rounded-t-md px-3 py-2 text-sm font-medium ${stage.color}`}>
                                <span>{stage.label}</span>
                                <span className="rounded-full bg-black/10 px-1.5 text-xs">{cards.length}</span>
                            </div>
                            <div className="min-h-24 space-y-2 rounded-b-md bg-muted/30 p-2">
                                {cards.length === 0 ? (
                                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>
                                ) : cards.map((d) => (
                                    <div
                                        key={d.id}
                                        draggable
                                        onDragStart={() => setDragged(d)}
                                        onDragEnd={() => setDragged(null)}
                                        className="cursor-grab rounded-md border border-border bg-card p-2 text-sm shadow-sm active:cursor-grabbing"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-[11px] text-muted-foreground">{d.orderRef}</span>
                                            <span className="tabular-nums font-semibold text-rose-700 dark:text-rose-300">₹{d.amount.toFixed(2)}</span>
                                        </div>
                                        <div className="mt-0.5 truncate font-medium">{d.customer ?? "Walk-in"}</div>
                                        <div className="text-[10px] text-muted-foreground">{d.createdAt.slice(0, 10)}{d.reason ? ` · ${d.reason}` : ""}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {stages.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
                        <Undo2 size={28} className="opacity-30" /> Refund pipeline (P9) not configured.
                    </div>
                )}
            </div>
        </div>
    );
}
