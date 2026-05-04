"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InvProductPicker } from "@/modules/inventory/components/InvProductPicker";

type Part = {
    id: number;
    quantity: number;
    notes: string | null;
    product: {
        id: number;
        sku: string;
        name: string;
        unit: { code: string };
        brand: { name: string } | null;
    };
};

export default function TicketPartsPanel({ ticketId }: { ticketId: number }) {
    const [parts, setParts] = useState<Part[]>([]);
    const [open, setOpen] = useState(false);
    const [invProductId, setInvProductId] = useState<number | null>(null);
    const [quantity, setQuantity] = useState("1");
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        axios
            .get<Part[]>(`/api/tickets/${ticketId}/parts`)
            .then((r) => setParts(r.data))
            .catch(() => toast.error("Failed to load parts"));
    }, [ticketId]);

    useEffect(() => { load(); }, [load]);

    const openAdd = () => {
        setInvProductId(null);
        setQuantity("1");
        setNotes("");
        setOpen(true);
    };

    const add = async () => {
        if (!invProductId) { toast.error("Select a product"); return; }
        const qty = parseFloat(quantity);
        if (!Number.isFinite(qty) || qty <= 0) { toast.error("Invalid quantity"); return; }
        setSaving(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/parts`, {
                invProductId,
                quantity: qty,
                notes: notes.trim() || null,
            });
            toast.success("Part added");
            setOpen(false);
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to add part");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (partId: number) => {
        if (!confirm("Remove this part?")) return;
        try {
            await axios.delete(`/api/tickets/${ticketId}/parts?partId=${partId}`);
            toast.success("Removed");
            load();
        } catch {
            toast.error("Failed to remove part");
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Wrench className="size-4" aria-hidden />
                    Parts used
                </h3>
                <Button type="button" variant="outline" size="sm" onClick={openAdd}>
                    <Plus className="size-4" /> Add part
                </Button>
            </div>

            {parts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No parts recorded.</p>
            ) : (
                <div className="divide-y divide-border border border-border rounded-md">
                    {parts.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                            <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs">{p.product.sku}</span>
                                <span className="ml-2 text-sm">{p.product.name}</span>
                                {p.product.brand && (
                                    <span className="ml-1 text-xs text-muted-foreground">· {p.product.brand.name}</span>
                                )}
                                {p.notes && <p className="text-xs text-muted-foreground mt-0.5">{p.notes}</p>}
                            </div>
                            <span className="text-sm tabular-nums shrink-0">
                                {p.quantity} {p.product.unit.code}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Remove"
                                onClick={() => remove(p.id)}
                            >
                                <Trash2 className="size-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add part</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-1">
                        <InvProductPicker value={invProductId} onChange={setInvProductId} />
                        <div className="space-y-1">
                            <Label>Quantity</Label>
                            <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Notes (optional)</Label>
                            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" onClick={add} disabled={saving}>
                                {saving ? "Saving…" : "Add"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
