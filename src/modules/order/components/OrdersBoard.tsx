"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Phase 1 of the O2C order backbone: one board for orders from every channel
// (counter POS_ORDER / office SALES_ORDER / online ShopOrder), all riding P7.
// Self-contained generic kanban for now; DRY with DealBoard/TaskBoard later.

interface Stage { id: string; label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }
interface OrderCard {
    source: "inv" | "shop"; id: number; ref: string;
    kind: "POS_ORDER" | "SALES_ORDER" | "SHOP";
    customerName: string | null; total: number; statusId: string | null;
    branchId: string | null; dealId: number | null; createdAt: string;
}

const KIND_BADGE: Record<OrderCard["kind"], string> = {
    POS_ORDER: "bg-indigo-100 text-indigo-700",
    SALES_ORDER: "bg-teal-100 text-teal-700",
    SHOP: "bg-violet-100 text-violet-700",
};
const KIND_LABEL: Record<OrderCard["kind"], string> = {
    POS_ORDER: "Counter", SALES_ORDER: "Office", SHOP: "Online",
};

export function OrdersBoard() {
    const [stages, setStages] = useState<Stage[]>([]);
    const [orders, setOrders] = useState<OrderCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragged, setDragged] = useState<OrderCard | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<{ stages: Stage[]; orders: OrderCard[] }>("/api/orders")
            .then((r) => { setStages(r.data.stages); setOrders(r.data.orders); })
            .catch(() => toast.error("Failed to load orders"))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);

    async function move(o: OrderCard, statusId: string) {
        if (o.statusId === statusId) return;
        const prev = orders;
        setOrders((arr) => arr.map((x) => (x.source === o.source && x.id === o.id ? { ...x, statusId } : x)));
        try {
            await axios.patch(`/api/orders/${o.source}/${o.id}/status`, { statusId });
        } catch (e) {
            setOrders(prev);
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : null;
            toast.error(msg || "That move isn't allowed");
        }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""} across all channels</p>
                <Button variant="outline" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4">
                {stages.map((stage) => {
                    const items = orders.filter((o) => o.statusId === stage.id);
                    return (
                        <div
                            key={stage.id}
                            className="w-72 shrink-0"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragged) void move(dragged, stage.id); setDragged(null); }}
                        >
                            <div className={`flex items-center justify-between rounded-t-md px-3 py-2 text-sm font-medium ${stage.color}`}>
                                <span>{stage.label}</span>
                                <span className="rounded-full bg-black/10 px-1.5 text-xs">{items.length}</span>
                            </div>
                            <div className="min-h-24 space-y-2 rounded-b-md bg-muted/30 p-2">
                                {items.length === 0 ? (
                                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>
                                ) : items.map((o) => (
                                    <div
                                        key={`${o.source}-${o.id}`}
                                        draggable
                                        onDragStart={() => setDragged(o)}
                                        onDragEnd={() => setDragged(null)}
                                        className="cursor-grab rounded-md border border-border bg-card p-2 text-sm shadow-sm active:cursor-grabbing"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-[11px] text-muted-foreground">{o.ref}</span>
                                            <Badge variant="outline" className={`text-[10px] ${KIND_BADGE[o.kind]}`}>{KIND_LABEL[o.kind]}</Badge>
                                        </div>
                                        <div className="mt-0.5 truncate font-medium">{o.customerName ?? "Walk-in"}</div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{o.createdAt.slice(0, 10)}</span>
                                            <span className="tabular-nums font-medium text-foreground">₹{o.total.toFixed(2)}</span>
                                        </div>
                                        {o.dealId && <div className="mt-0.5 text-[10px] text-muted-foreground">Deal #{o.dealId}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {stages.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
                        <ShoppingCart size={28} className="opacity-30" />
                        Orders pipeline (P7) not configured.
                    </div>
                )}
            </div>
        </div>
    );
}
