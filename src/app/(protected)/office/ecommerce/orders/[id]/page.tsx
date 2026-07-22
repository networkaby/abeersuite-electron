"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import OrderStatusActions from "@/modules/ecommerce/components/OrderStatusActions";
import { OrderSourceBadge } from "@/modules/ecommerce/components/OrderSourceBadge";
import type { OrderSource, ShopOrderStatus } from "@/generated/prisma/enums";
import { toast } from "sonner";
import { FileText, ExternalLink, CreditCard, Truck } from "lucide-react";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";

type NextPipelineStatus = {
    id: string;
    label: string;
    color: string;
    isTerminal: boolean;
    actionLabel: string | null;
};

type ShippingAddressJson = {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string | null;
    locality?: string | null;
    neighbourhood?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    courierService?: string;
    /** Online gateway chosen at checkout ("razorpay" | "payu" | …). */
    onlineProvider?: string | null;
    /** Auto-posted advance receipt for the online payment. */
    receiptVoucherId?: number;
    receiptVoucherRef?: string;
};

type OrderDetail = {
    id: number;
    orderSource: OrderSource;
    // Legacy enum status (Razorpay / old orders)
    status: ShopOrderStatus;
    // Pipeline status
    statusId: string | null;
    pipelineId: string | null;
    orderStatus: {
        id: string;
        label: string;
        color: string;
        isTerminal: boolean;
        fromTransitions: { to: NextPipelineStatus }[];
    } | null;
    paymentMethod: "COD" | "ONLINE";
    totalPaise: number;
    shippingChargePaise: number;
    razorpayPaymentId: string | null;
    shippingName: string | null;
    shippingAddress: ShippingAddressJson | null;
    courier: string | null;
    trackingNumber: string | null;
    createdAt: string;
    paidAt: string | null;
    shippedAt: string | null;
    // The order's Person (portal customer) — API include, with contact rows.
    person: {
        id: number;
        name: string;
        phones: { phone: string }[];
        emails: { email: string }[];
    } | null;
    account: {
        id: number;
        name: string;
        person: { id: number; name: string; phones: { phone: string }[] } | null;
        company: { id: number; name: string } | null;
    } | null;
    lines: {
        id: number;
        quantity: number;
        unitPricePaise: number;
        product: { id: number; name: string; imageUrl: string | null };
    }[];
    tickets: { id: number; status: string; createdAt: string }[];
    // Renamed `invoice` → `invVoucher` on 2026-05-24 (Invoice → InvVoucher
    // consolidation, Layer 4a). Reference is `voucher.reference`; status
    // is the InvVoucher status enum (DRAFT / POSTED / CANCELLED).
    invVoucher: {
        id: number;
        reference: string;
        type: string;
        status: string;
        totalAmount: string;
    } | null;
};

// The API returns `account.person` / `account.company` (the Account bridge) plus
// the order's own `person` (portal customer include) — fall through in that order.
function partyLabel(order: OrderDetail): string {
    if (order.account?.person?.name) return order.account.person.name;
    if (order.account?.company?.name) return order.account.company.name;
    if (order.account?.name) return order.account.name;
    if (order.person?.name) return order.person.name;
    return order.shippingName ?? "—";
}

export default function EcommerceOrderDetailPage() {
    const params = useParams();
    const id = Number(params.id);
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [returnOpen, setReturnOpen] = useState(false);
    const [rBrand, setRBrand] = useState("");
    const [rModel, setRModel] = useState("");
    const [rProblem, setRProblem] = useState("");

    const load = useCallback(() => {
        if (!Number.isFinite(id)) return;
        axios
            .get<OrderDetail>(`/api/ecommerce/orders/${id}`)
            .then((r) => setOrder(r.data))
            .catch(() => setOrder(null));
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    // One-click convert: order → posted ONLINE_INVOICE (party + lines prefilled
    // server-side, advance receipt auto-allocated). Idempotent server-side.
    const [invoicing, setInvoicing] = useState(false);
    const createInvoice = async () => {
        setInvoicing(true);
        try {
            const res = await axios.post<{ reference: string | null; already?: boolean }>(
                `/api/ecommerce/orders/${id}/invoice`,
            );
            toast.success(
                res.data.already
                    ? `Invoice already exists (${res.data.reference ?? ""})`
                    : `Invoice ${res.data.reference ?? ""} created & posted`,
            );
            load();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : null;
            toast.error(msg ?? "Failed to create the invoice");
        } finally {
            setInvoicing(false);
        }
    };

    const spawnReturn = async () => {
        if (!rBrand.trim() || !rModel.trim() || !rProblem.trim()) {
            toast.error("Brand, model, and problem are required");
            return;
        }
        try {
            const res = await axios.post<{ id: number }>(`/api/ecommerce/orders/${id}/return-ticket`, {
                brand: rBrand.trim(),
                model: rModel.trim(),
                problem: rProblem.trim(),
            });
            toast.success(`Ticket #${res.data.id} created`);
            setReturnOpen(false);
            load();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Failed";
            toast.error(msg ?? "Failed");
        }
    };

    if (!Number.isFinite(id)) {
        return <p className="text-destructive">Invalid order id.</p>;
    }

    if (!order) {
        return <p className="text-muted-foreground">Loading…</p>;
    }

    // Derive the display status label + color
    const statusLabel = order.orderStatus?.label ?? order.status;
    const statusColor = order.orderStatus?.color ?? "bg-gray-100 text-gray-600";

    // Next statuses for pipeline mode
    const nextStatuses: NextPipelineStatus[] | undefined = order.orderStatus
        ? order.orderStatus.fromTransitions.map((t) => t.to)
        : undefined;

    // Payment summary — method, paid-state, gateway + auto-posted receipt refs.
    const addr = order.shippingAddress ?? {};
    const grandPaise = order.totalPaise + (order.shippingChargePaise ?? 0);
    const isPaid = order.status === "PAID" || !!order.paidAt;
    const isCod = order.paymentMethod === "COD";
    const providerLabel =
        addr.onlineProvider
            ? { razorpay: "Razorpay", payu: "PayU", cashfree: "Cashfree", demo: "Demo gateway" }[addr.onlineProvider] ?? addr.onlineProvider
            : null;

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
                        <Link href="/office/ecommerce/orders">← Orders</Link>
                    </Button>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl font-semibold tracking-tight">Order #{order.id}</h1>
                        <OrderSourceBadge source={order.orderSource} />
                        <Badge className={`text-xs font-medium ${statusColor}`} variant="outline">
                            {statusLabel}
                        </Badge>
                        {/* Payment state at a glance */}
                        <Badge
                            className={
                                isPaid
                                    ? "bg-green-100 text-green-700"
                                    : isCod
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-red-100 text-red-600"
                            }
                        >
                            {isPaid ? "Paid" : isCod ? "Pay on delivery" : "Payment pending"}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm mt-1">
                        {new Date(order.createdAt).toLocaleString("en-IN")}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-lg font-semibold">{formatRupeesFromPaise(grandPaise)}</p>
                    <p className="text-muted-foreground text-xs">
                        Items {formatRupeesFromPaise(order.totalPaise)} + shipping{" "}
                        {formatRupeesFromPaise(order.shippingChargePaise ?? 0)}
                    </p>
                    {(addr.courierService || order.courier) && (
                        <p className="text-muted-foreground text-xs">
                            {addr.courierService ?? order.courier}
                            {order.trackingNumber ? ` · ${order.trackingNumber}` : ""}
                        </p>
                    )}
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-6">
                    {/* Status actions — pipeline mode if statusId set, legacy enum otherwise */}
                    <OrderStatusActions
                        orderId={order.id}
                        onUpdated={load}
                        statusId={order.statusId}
                        nextStatuses={nextStatuses}
                        status={order.statusId ? null : order.status}
                    />

                    {/* Invoice — required before Packing, so it sits right next to the
                        status action it gates rather than buried lower on the page. */}
                    <div
                        className={`rounded-lg border p-4 ${
                            order.invVoucher ? "border-border" : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
                        }`}
                    >
                        <h2 className="mb-3 font-medium flex items-center gap-2">
                            <FileText size={15} className="text-muted-foreground" />
                            Invoice
                            {!order.invVoucher && (
                                <Badge className="bg-amber-100 text-amber-700">Required before packing</Badge>
                            )}
                        </h2>
                        {order.invVoucher ? (() => {
                            const v = order.invVoucher;
                            const href = editFormUrl(v.type, v.id) ?? "#";
                            return (
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-mono text-sm font-semibold text-primary">{v.reference}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {v.status} · {formatRupeesFromPaise(Math.round(Number(v.totalAmount) * 100))}
                                        </p>
                                    </div>
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href={href}>
                                            <ExternalLink size={13} /> Open voucher
                                        </Link>
                                    </Button>
                                </div>
                            );
                        })() : (
                            <div className="space-y-2">
                                <Button type="button" size="sm" disabled={invoicing} onClick={() => void createInvoice()}>
                                    <FileText size={13} />
                                    {invoicing ? "Creating…" : "Create invoice"}
                                </Button>
                                <p className="text-xs text-muted-foreground">
                                    One click — posts an Online Invoice from the order&apos;s items
                                    (stock + GST + ledger), links it here, and settles it against the
                                    online payment.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Line items */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-3 font-medium">Line items</h2>
                        <ul className="space-y-2 text-sm">
                            {order.lines.map((l) => (
                                <li key={l.id} className="flex justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                                    <span>{l.product.name}</span>
                                    <span className="text-muted-foreground">
                                        ×{l.quantity} · {formatRupeesFromPaise(l.unitPricePaise * l.quantity)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
                            <p className="flex justify-between text-muted-foreground">
                                <span>Items</span>
                                <span>{formatRupeesFromPaise(order.totalPaise)}</span>
                            </p>
                            <p className="flex justify-between text-muted-foreground">
                                <span>Shipping{addr.courierService ? ` · ${addr.courierService}` : ""}</span>
                                <span>
                                    {(order.shippingChargePaise ?? 0) === 0
                                        ? "FREE"
                                        : formatRupeesFromPaise(order.shippingChargePaise ?? 0)}
                                </span>
                            </p>
                            <p className="flex justify-between font-semibold">
                                <span>Total</span>
                                <span>{formatRupeesFromPaise(grandPaise)}</span>
                            </p>
                        </div>
                    </div>

                    {/* Return ticket */}
                    <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
                        <DialogTrigger asChild>
                            <Button type="button" variant="outline">
                                Spawn return ticket
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Return / RMA ticket</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-3 py-2">
                                <div className="grid gap-1.5">
                                    <Label>Device brand</Label>
                                    <Input value={rBrand} onChange={(e) => setRBrand(e.target.value)} />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label>Model</Label>
                                    <Input value={rModel} onChange={(e) => setRModel(e.target.value)} />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label>Problem</Label>
                                    <Input value={rProblem} onChange={(e) => setRProblem(e.target.value)} />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" onClick={() => void spawnReturn()}>
                                    Create ticket
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Linked repair tickets */}
                    {order.tickets.length > 0 && (
                        <div className="rounded-lg border border-border p-4 text-sm">
                            <h2 className="mb-2 font-medium">Linked tickets</h2>
                            <ul className="space-y-2">
                                {order.tickets.map((t) => (
                                    <li key={t.id} className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">
                                            Ticket #{t.id} · {t.status}
                                        </span>
                                        <Button variant="outline" size="sm" asChild>
                                            <Link href={`/office/repairing/tickets/${t.id}`}>
                                                <ExternalLink size={13} /> Open
                                            </Link>
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    {/* Payment panel — method, state, gateway ref, auto-posted receipt */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-2 font-medium flex items-center gap-2">
                            <CreditCard size={15} className="text-muted-foreground" />
                            Payment
                        </h2>
                        <div className="space-y-1 text-sm">
                            <p className="flex justify-between">
                                <span className="text-muted-foreground">Method</span>
                                <span className="font-medium">
                                    {isCod ? "Pay on delivery" : `Online${providerLabel ? ` · ${providerLabel}` : ""}`}
                                </span>
                            </p>
                            <p className="flex justify-between">
                                <span className="text-muted-foreground">Status</span>
                                <span className={isPaid ? "font-medium text-green-700" : "font-medium text-amber-700"}>
                                    {isPaid
                                        ? `Paid${order.paidAt ? ` · ${new Date(order.paidAt).toLocaleString("en-IN")}` : ""}`
                                        : isCod
                                          ? "Due on delivery"
                                          : "Awaiting payment"}
                                </span>
                            </p>
                            <p className="flex justify-between">
                                <span className="text-muted-foreground">Amount</span>
                                <span className="font-medium">{formatRupeesFromPaise(grandPaise)}</span>
                            </p>
                            {order.razorpayPaymentId && (
                                <p className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">Gateway ref</span>
                                    <span className="font-mono text-xs break-all text-right">{order.razorpayPaymentId}</span>
                                </p>
                            )}
                        </div>
                        {addr.receiptVoucherId ? (
                            <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                                <div>
                                    <p className="font-mono text-sm font-semibold text-primary">
                                        {addr.receiptVoucherRef ?? `Receipt #${addr.receiptVoucherId}`}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Auto-posted receipt</p>
                                </div>
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={`/vouchers/receipts/${addr.receiptVoucherId}`}>
                                        <ExternalLink size={13} /> Open receipt
                                    </Link>
                                </Button>
                            </div>
                        ) : isPaid && !isCod ? (
                            <p className="mt-2 text-xs text-amber-700">
                                No receipt voucher recorded — check the gateway&apos;s settlement ledger.
                            </p>
                        ) : null}
                    </div>

                    {/* Party / customer panel */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-2 font-medium">Billed to</h2>
                        <p className="font-medium">{partyLabel(order)}</p>
                        {(order.account?.person?.phones?.[0]?.phone || order.person?.phones?.[0]?.phone) && (
                            <p className="text-muted-foreground text-sm">
                                {order.account?.person?.phones?.[0]?.phone ?? order.person?.phones?.[0]?.phone}
                            </p>
                        )}
                        {order.person?.emails?.[0]?.email && (
                            <p className="text-muted-foreground text-sm">{order.person.emails[0].email}</p>
                        )}
                        {order.account?.company && (
                            <p className="text-xs text-muted-foreground mt-1">Company: {order.account.company.name}</p>
                        )}
                    </div>

                    {/* Ship to — the address the customer entered at checkout */}
                    {order.shippingAddress ? (
                        <div className="rounded-lg border border-border p-4 text-sm">
                            <h2 className="mb-2 font-medium flex items-center gap-2">
                                <Truck size={15} className="text-muted-foreground" />
                                Ship to
                            </h2>
                            <p className="font-medium">{addr.name ?? order.shippingName ?? "—"}</p>
                            {addr.phone && <p className="text-muted-foreground">{addr.phone}</p>}
                            <p className="text-muted-foreground">
                                {[addr.line1, addr.line2, addr.neighbourhood, addr.locality]
                                    .filter(Boolean)
                                    .join(", ")}
                            </p>
                            <p className="text-muted-foreground">
                                {[addr.city, addr.state, addr.pincode].filter(Boolean).join(", ")}
                            </p>
                            {(addr.courierService || order.courier) && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Courier: {addr.courierService ?? order.courier}
                                    {order.trackingNumber ? ` · ${order.trackingNumber}` : ""}
                                </p>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
