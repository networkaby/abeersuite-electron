"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface OrderLine { id: number; productId: number; description: string | null; quantity: number; rate: number; taxRate: number; mrpPaise: number | null; savedSalePricePaise: number | null; amount: number }
interface OrderDetail { id: number; ref: string; customer: string | null; statusId: string | null; editable: boolean; discountPct: number | null; totalAmount: number; lines: OrderLine[] }

const money = (n: number) => `₹${n.toFixed(2)}`;
// No input type=number (house rule) — keep digits + one dot, clamp ≥ 0.
const sanitizeQty = (s: string) => { const c = s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); return c; };

export function OrderEditDialog({ orderId, open, onClose, onSaved }: { orderId: number | null; open: boolean; onClose: () => void; onSaved: () => void }) {
    const [detail, setDetail] = useState<OrderDetail | null>(null);
    const [lines, setLines] = useState<OrderLine[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        if (orderId == null) return;
        setLoading(true);
        axios.get<OrderDetail>(`/api/orders/inv/${orderId}`)
            .then((r) => { setDetail(r.data); setLines(r.data.lines); })
            .catch(() => toast.error("Failed to load order"))
            .finally(() => setLoading(false));
    }, [orderId]);
    useEffect(() => { if (open) load(); }, [open, load]);

    const setQty = (id: number, raw: string) => {
        const q = sanitizeQty(raw);
        setLines((arr) => arr.map((l) => (l.id === id ? { ...l, quantity: q === "" ? 0 : Number(q), amount: (q === "" ? 0 : Number(q)) * l.rate } : l)));
    };
    const removeLine = (id: number) => setLines((arr) => arr.filter((l) => l.id !== id));

    const subtotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
    const tax = lines.reduce((s, l) => s + (l.quantity * l.rate * (l.taxRate || 0)) / 100, 0);
    const discount = detail?.discountPct ? (subtotal * detail.discountPct) / 100 : 0;
    const total = subtotal + tax - discount;

    async function save() {
        if (orderId == null) return;
        if (lines.length === 0) { toast.error("An order needs at least one line"); return; }
        if (lines.some((l) => !(l.quantity > 0))) { toast.error("Every line needs a quantity > 0"); return; }
        setSaving(true);
        try {
            await axios.patch(`/api/orders/inv/${orderId}`, {
                lines: lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, rate: l.rate, taxRate: l.taxRate, mrpPaise: l.mrpPaise, savedSalePricePaise: l.savedSalePricePaise })),
                discountPct: detail?.discountPct ?? null,
            });
            toast.success("Order updated");
            onSaved();
            onClose();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : null;
            toast.error(msg || "Couldn't save the edit");
        } finally {
            setSaving(false);
        }
    }

    const editable = detail?.editable ?? false;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>Order {detail?.ref ?? ""}{detail?.customer ? ` — ${detail.customer}` : ""}</DialogTitle></DialogHeader>
                {loading ? (
                    <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : (
                    <>
                        {!editable && (
                            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                Read-only — only orders at <b>New</b> / <b>Under Review</b> can be edited. Move it back to Review to drop a line.
                            </p>
                        )}
                        <div className="max-h-72 space-y-1.5 overflow-y-auto">
                            {lines.map((l) => (
                                <div key={l.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{l.description ?? `#${l.productId}`}</div>
                                        <div className="text-xs text-muted-foreground">{money(l.rate)} · GST {l.taxRate}%</div>
                                    </div>
                                    <Input
                                        value={String(l.quantity)}
                                        onChange={(e) => setQty(l.id, e.target.value)}
                                        disabled={!editable}
                                        className="h-8 w-16 text-right"
                                        inputMode="decimal"
                                    />
                                    <div className="w-20 text-right tabular-nums">{money(l.quantity * l.rate)}</div>
                                    {editable && (
                                        <button type="button" onClick={() => removeLine(l.id)} className="text-muted-foreground hover:text-destructive" title="Drop this line">
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="space-y-0.5 border-t pt-2 text-sm">
                            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
                            <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="tabular-nums">{money(tax)}</span></div>
                            {discount > 0 && <div className="flex justify-between text-muted-foreground"><span>Discount{detail?.discountPct ? ` (${detail.discountPct}%)` : ""}</span><span className="tabular-nums">−{money(discount)}</span></div>}
                            <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
                        </div>
                    </>
                )}
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
                    {editable && <Button onClick={() => void save()} disabled={saving || loading}>{saving ? "Saving…" : "Save changes"}</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
