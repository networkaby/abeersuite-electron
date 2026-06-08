"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, Truck, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Stage { id: string; label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }
interface DeliveryCard { id: number; statusId: string | null; carrier: string | null; awb: string | null; trackingUrl: string | null; orderRef: string; customer: string | null; createdAt: string }

const CARRIERS = ["OWN_BOY", "PICKUP", "SHIPROCKET", "DTDC", "MARUTI"] as const;
const CARRIER_LABEL: Record<string, string> = {
    SHIPROCKET: "Shiprocket", DTDC: "DTDC", MARUTI: "Maruti", OWN_BOY: "Own boy", PICKUP: "Pickup",
};

export function DeliveryBoard() {
    const [stages, setStages] = useState<Stage[]>([]);
    const [items, setItems] = useState<DeliveryCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragged, setDragged] = useState<DeliveryCard | null>(null);
    const [editing, setEditing] = useState<DeliveryCard | null>(null);
    const [form, setForm] = useState<{ carrier: string; awb: string; trackingUrl: string }>({ carrier: "", awb: "", trackingUrl: "" });
    const [saving, setSaving] = useState(false);

    function openEdit(d: DeliveryCard) {
        setForm({ carrier: d.carrier ?? "", awb: d.awb ?? "", trackingUrl: d.trackingUrl ?? "" });
        setEditing(d);
    }
    async function saveEdit() {
        if (!editing) return;
        setSaving(true);
        try {
            await axios.patch(`/api/deliveries/${editing.id}`, {
                carrier: form.carrier || null,
                awb: form.awb,
                trackingUrl: form.trackingUrl,
            });
            toast.success("Delivery updated");
            setEditing(null);
            load();
        } catch {
            toast.error("Couldn't save");
        } finally {
            setSaving(false);
        }
    }

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
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); openEdit(d); }}
                                            className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                                        >
                                            <Pencil size={10} /> carrier / AWB
                                        </button>
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

            <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Delivery — {editing?.orderRef}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Carrier</div>
                            <div className="flex flex-wrap gap-1.5">
                                {CARRIERS.map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setForm((f) => ({ ...f, carrier: c }))}
                                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${form.carrier === c ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}
                                    >
                                        {CARRIER_LABEL[c]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">AWB / docket number</div>
                            <Input value={form.awb} onChange={(e) => setForm((f) => ({ ...f, awb: e.target.value }))} placeholder="Tracking / docket number" className="h-9" />
                        </div>
                        <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Tracking URL</div>
                            <Input value={form.trackingUrl} onChange={(e) => setForm((f) => ({ ...f, trackingUrl: e.target.value }))} placeholder="https://…" className="h-9" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
                        <Button onClick={() => void saveEdit()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
