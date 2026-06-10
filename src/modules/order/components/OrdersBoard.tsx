"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput } from "@/shared/lib/format";
import { Loader2, RefreshCw, ShoppingCart, AlertCircle, FolderOpen, Eye, Check, Ban, Package, MapPin, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";

// Phase 1 of the O2C order backbone: one board for orders from every channel
// (counter POS_ORDER / office SALES_ORDER / online ShopOrder), all riding P7.
// Self-contained generic kanban for now; DRY with DealBoard/TaskBoard later.

interface Stage { id: string; label: string; color: string; order: number; isTerminal: boolean; isEntryPoint: boolean }
interface OrderCard {
    source: "inv" | "shop"; id: number; ref: string;
    kind: "POS_ORDER" | "SALES_ORDER" | "SHOP";
    customerName: string | null; total: number; statusId: string | null;
    branchId: string | null; dealId: number | null; createdAt: string;
    credit: { limit: number; outstanding: number; breach: boolean } | null;
}

// Order detail for the Review popup (GET /api/orders/[source]/[id]).
interface OrderLineDetail { id: number; name: string; quantity: number; rate: number; available: number | null; deliverable: boolean }
interface OrderDetail {
    id: number; ref: string; customer: string | null; statusId: string | null;
    address: string | null; totalAmount: number; lines: OrderLineDetail[];
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
    const router = useRouter();

    // G4b — pay-at-Fulfil. Cash/bank ledgers for the settlement picker, plus the
    // dialog state (which order is being fulfilled, the collected amount + ledger).
    const [cashBank, setCashBank] = useState<GlAccount[]>([]);
    const [fulfilTarget, setFulfilTarget] = useState<OrderCard | null>(null);
    const [payLedgerId, setPayLedgerId] = useState<string>("");
    const [payAmount, setPayAmount] = useState<string>("");
    const [fulfilling, setFulfilling] = useState(false);
    const [fulfilErr, setFulfilErr] = useState<string | null>(null);

    // Review popup: inspect items + customer/address deliverability, then Confirm/Reject.
    const [viewTarget, setViewTarget] = useState<OrderCard | null>(null);
    const [viewData, setViewData] = useState<OrderDetail | null>(null);
    const [viewLoading, setViewLoading] = useState(false);
    const [reviewBusy, setReviewBusy] = useState(false);

    // Fetch only sets state in async callbacks (no synchronous setState in the
    // mount effect — initial loading=true covers first paint; Refresh sets it).
    const load = useCallback(() => {
        axios.get<{ stages: Stage[]; orders: OrderCard[] }>("/api/orders")
            .then((r) => { setStages(r.data.stages); setOrders(r.data.orders); })
            .catch(() => toast.error("Failed to load orders"))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);

    // Cash/bank tills the operator can receive a fulfil payment into (same source
    // the office voucher form uses for its tender picker).
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => setCashBank(r.data.filter((a) =>
                a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND || a.group?.name === ACCOUNT_GROUPS.BANK_ACCOUNTS)))
            .catch(() => setCashBank([]));
    }, []);

    async function move(o: OrderCard, statusId: string) {
        if (o.statusId === statusId) return;
        const prev = orders;
        setOrders((arr) => arr.map((x) => (x.source === o.source && x.id === o.id ? { ...x, statusId } : x)));
        try {
            await axios.patch(`/api/orders/${o.source}/${o.id}/status`, { statusId });
        } catch (e) {
            setOrders(prev);
            toast.error(extractApiError(e, "That move isn't allowed"));
        }
    }

    // Open the fulfil dialog (G4b): pick a settlement ledger + collect payment.
    function openFulfil(o: OrderCard) {
        if (o.source !== "inv") { toast.info("Online-order fulfilment is coming soon."); return; }
        setFulfilErr(null);
        setPayAmount("");
        const def = cashBank.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND) ?? cashBank[0] ?? null;
        setPayLedgerId(def ? String(def.id) : "");
        setFulfilTarget(o);
    }

    async function confirmFulfil() {
        const o = fulfilTarget;
        if (!o) return;
        const amt = Number(payAmount);
        const collecting = payAmount.trim() !== "" && amt > 0;
        if (collecting && !payLedgerId) { setFulfilErr("Pick a ledger to receive the payment."); return; }
        if (collecting && amt > o.total + 0.01) { setFulfilErr("Payment can't exceed the order total."); return; }
        const payments = collecting ? [{ accountId: Number(payLedgerId), amount: amt }] : [];
        setFulfilling(true);
        setFulfilErr(null);
        try {
            const { data } = await axios.post<{ saleRef: string; paid: number; onCredit: number }>(`/api/orders/inv/${o.id}/fulfil`, { payments });
            toast.success(`Fulfilled — Sale ${data.saleRef} posted${data.onCredit > 0.005 ? ` · ₹${data.onCredit.toFixed(2)} on credit` : ""}`);
            setFulfilTarget(null);
            load();
        } catch (e) {
            setFulfilErr(extractApiError(e, "Fulfil failed"));
        } finally {
            setFulfilling(false);
        }
    }

    function editOrder(o: OrderCard) {
        if (o.source !== "inv") { toast.info("Online orders are managed in the ecommerce admin."); return; }
        // Reopen in the same POS screen that created it (Phase B edit mode).
        router.push(`/vouchers/pos/order?id=${o.id}`);
    }

    // Open the Review popup: fetch the order's items + customer address so the
    // reviewer can judge "is the item in stock and the address deliverable?".
    function openView(o: OrderCard) {
        if (o.source !== "inv") { toast.info("Online orders are reviewed in the ecommerce admin."); return; }
        setViewData(null);
        setViewLoading(true);
        setViewTarget(o);
        axios.get<OrderDetail>(`/api/orders/inv/${o.id}`)
            .then((r) => setViewData(r.data))
            .catch(() => { toast.error("Couldn't load the order"); setViewTarget(null); })
            .finally(() => setViewLoading(false));
    }

    // Review decision → a P7 stage move via the status route (Confirm reserves stock +
    // spawns delivery; Reject releases the hold). Reused for the non-review Cancel too.
    async function review(o: OrderCard, statusId: string) {
        setReviewBusy(true);
        try {
            await axios.patch(`/api/orders/inv/${o.id}/status`, { statusId });
            toast.success(
                statusId === ORDER_STAGE.CONFIRMED ? `Order ${o.ref} confirmed`
                    : statusId === ORDER_STAGE.CANCELLED ? `Order ${o.ref} rejected`
                        : `Order ${o.ref} updated`,
            );
            setViewTarget(null);
            load();
        } catch (e) {
            toast.error(extractApiError(e, "That action isn't allowed"));
        } finally {
            setReviewBusy(false);
        }
    }

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>;

    // Review-popup derived state.
    const vStage = viewTarget ? stages.find((s) => s.id === viewTarget.statusId) ?? null : null;
    const inReview = viewTarget != null && (viewTarget.statusId === ORDER_STAGE.NEW || viewTarget.statusId === ORDER_STAGE.UNDER_REVIEW);
    const allDeliverable = (viewData?.lines.length ?? 0) > 0 && (viewData?.lines.every((l) => l.deliverable) ?? false);
    const hasAddress = !!viewData?.address && viewData.address.trim().length > 0;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""} across all channels</p>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}><RefreshCw size={14} /> Refresh</Button>
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
                                        {o.credit?.breach && (
                                            <div
                                                className="mt-1 flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                                                title={o.credit.limit === 0
                                                    ? "No credit facility — collect payment before fulfilling"
                                                    : `Outstanding ₹${o.credit.outstanding.toLocaleString("en-IN")} + this order exceeds the ₹${o.credit.limit.toLocaleString("en-IN")} credit limit`}
                                            >
                                                <AlertCircle size={11} className="shrink-0" />
                                                {o.credit.limit === 0 ? "No credit — collect payment" : "Over credit limit"}
                                            </div>
                                        )}
                                        {o.source === "inv" && (
                                            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => editOrder(o)}
                                                    className="flex items-center justify-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                                                    title="Open the full order page"
                                                >
                                                    <FolderOpen size={12} /> Open
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openView(o)}
                                                    className="flex items-center justify-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                                                    title="Review items + customer / address"
                                                >
                                                    <Eye size={12} /> View
                                                </button>
                                            </div>
                                        )}
                                        {o.source === "inv" && !stage.isTerminal && (
                                            <button
                                                type="button"
                                                onClick={() => openFulfil(o)}
                                                className="mt-1.5 w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                                title="Post the Sale (GL + stock-out) and mark Delivered"
                                            >
                                                Fulfil → post Sale
                                            </button>
                                        )}
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

            <Dialog open={fulfilTarget != null} onOpenChange={(open) => { if (!open && !fulfilling) setFulfilTarget(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Fulfil order {fulfilTarget?.ref}</DialogTitle>
                    </DialogHeader>
                    {fulfilTarget && (
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Customer</span>
                                <span className="font-medium">{fulfilTarget.customerName ?? "Walk-in"}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Order total</span>
                                <span className="font-semibold tabular-nums">₹{fulfilTarget.total.toFixed(2)}</span>
                            </div>
                            {fulfilTarget.credit?.breach && (
                                <div className="flex items-start gap-1.5 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                                    <span>{fulfilTarget.credit.limit === 0
                                        ? "No credit facility — collect payment in full to fulfil."
                                        : "Over the customer's credit limit — collect at least the excess to fulfil."}</span>
                                </div>
                            )}
                            <div className="space-y-2 rounded-md border border-border p-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">Collect payment</span>
                                    <button type="button" onClick={() => setPayAmount(String(fulfilTarget.total))} className="text-xs text-primary hover:underline">
                                        Pay full
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <Select value={payLedgerId} onValueChange={setPayLedgerId}>
                                        <SelectTrigger><SelectValue placeholder="Cash / Bank" /></SelectTrigger>
                                        <SelectContent>
                                            {cashBank.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={payAmount}
                                        onChange={(e) => setPayAmount(parseDecimalInput(e.target.value))}
                                    />
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Leave blank to fulfil on credit — any balance becomes the customer&apos;s due.
                                </p>
                            </div>
                            {fulfilErr && <p className="text-xs text-destructive">{fulfilErr}</p>}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFulfilTarget(null)} disabled={fulfilling}>Cancel</Button>
                        <Button onClick={() => void confirmFulfil()} disabled={fulfilling}>
                            {fulfilling && <Loader2 className="animate-spin" size={14} />}
                            Fulfil → post Sale
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={viewTarget != null} onOpenChange={(open) => { if (!open && !reviewBusy) setViewTarget(null); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Review order {viewTarget?.ref}</DialogTitle>
                    </DialogHeader>
                    {viewLoading || !viewData ? (
                        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
                    ) : (
                        <div className="space-y-3 text-sm">
                            {/* Customer + delivery address */}
                            <div className="rounded-md border border-border p-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">{viewData.customer ?? "Walk-in"}</span>
                                    <span className="tabular-nums font-semibold">₹{viewData.totalAmount.toFixed(2)}</span>
                                </div>
                                <div className={`mt-1 flex items-start gap-1.5 text-xs ${hasAddress ? "text-muted-foreground" : "text-destructive"}`}>
                                    <MapPin size={13} className="mt-0.5 shrink-0" />
                                    <span>{hasAddress ? viewData.address : "No delivery address on file — address not deliverable."}</span>
                                </div>
                            </div>

                            {/* Item list with per-line deliverability */}
                            <div className="rounded-md border border-border">
                                <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                                    <Package size={13} /> Items ({viewData.lines.length})
                                </div>
                                <ul className="divide-y divide-border">
                                    {viewData.lines.map((l) => (
                                        <li key={l.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                            <div className="min-w-0">
                                                <div className="truncate">{l.name}</div>
                                                <div className="text-[11px] text-muted-foreground tabular-nums">
                                                    {l.quantity} × ₹{l.rate.toFixed(2)}
                                                    {l.available != null && <> · {l.available} in stock</>}
                                                </div>
                                            </div>
                                            {l.deliverable ? (
                                                <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                                    <CheckCircle2 size={11} /> In stock
                                                </span>
                                            ) : (
                                                <span className="flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                                                    <XCircle size={11} /> Short
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Overall deliverability verdict */}
                            <div className={`flex items-start gap-1.5 rounded px-2 py-1.5 text-xs ${allDeliverable && hasAddress ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                                {allDeliverable && hasAddress
                                    ? <><CheckCircle2 size={13} className="mt-0.5 shrink-0" /> Items in stock and address on file — deliverable.</>
                                    : <><AlertCircle size={13} className="mt-0.5 shrink-0" /> {!allDeliverable && "Some items are short on stock. "}{!hasAddress && "No delivery address. "}Confirm only if you can fulfil it.</>}
                            </div>
                        </div>
                    )}
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button variant="outline" onClick={() => setViewTarget(null)} disabled={reviewBusy}>Close</Button>
                        {viewTarget && viewData && inReview && (
                            <>
                                <Button variant="destructive" onClick={() => void review(viewTarget, ORDER_STAGE.CANCELLED)} disabled={reviewBusy}>
                                    {reviewBusy ? <Loader2 className="animate-spin" size={14} /> : <Ban size={14} />} Reject
                                </Button>
                                <Button onClick={() => void review(viewTarget, ORDER_STAGE.CONFIRMED)} disabled={reviewBusy}>
                                    {reviewBusy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Confirm
                                </Button>
                            </>
                        )}
                        {viewTarget && viewData && !inReview && vStage && !vStage.isTerminal && (
                            <Button variant="destructive" onClick={() => void review(viewTarget, ORDER_STAGE.CANCELLED)} disabled={reviewBusy}>
                                {reviewBusy ? <Loader2 className="animate-spin" size={14} /> : <Ban size={14} />} Cancel order
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
