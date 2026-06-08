"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Stage { id: string; label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }
interface DeliveryCard { id: number; statusId: string | null; carrier: string | null; awb: string | null; orderRef: string; customer: string | null; createdAt: string }

const CARRIER_LABEL: Record<string, string> = {
    SHIPROCKET: "Shiprocket", DTDC: "DTDC", MARUTI: "Maruti", OWN_BOY: "Own boy", PICKUP: "Pickup",
};

export function DeliveryBoard() {
    const [stages, setStages] = useState<Stage[]>([]);
    const [items, setItems] = useState<DeliveryCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragged, setDragged] = useState<DeliveryCard | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<{ stages: Stage[]; deliveries: DeliveryCard[] }>("/api/deliveries")
            .then((r) => { setStages(r.data.stages); setItems(r.data.deliveries); })
            .catch(() => toast.error("Failed to load deliveries"))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);

    async function move(d: DeliveryCard, statusId: string) {
        if (d.statusId === statusId) return;
        const prev = items;
        setItems((arr) => arr.map((x) => (x.id === d.id ? { ...x, statusId } : x)));
        try {
            await axios.patch(`/api/deliveries/${d.id}/status`, { statusId });
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
                <p className="text-sm text-muted-foreground">{items.length} deliver{items.length !== 1 ? "ies" : "y"}</p>
                <Button variant="outline" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Button>
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
                                            <Badge variant="outline" className="text-[10px]">{d.carrier ? CARRIER_LABEL[d.carrier] ?? d.carrier : "—"}</Badge>
                                        </div>
                                        <div className="mt-0.5 truncate font-medium">{d.customer ?? "Walk-in"}</div>
                                        {d.awb && <div className="text-[10px] text-muted-foreground">AWB {d.awb}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {stages.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
                        <Truck size={28} className="opacity-30" /> Delivery pipeline (P8) not configured.
                    </div>
                )}
            </div>
        </div>
    );
}
