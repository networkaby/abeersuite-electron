"use client";

import { JOURNEY, STAGE_ORDER, type PortalOrderDto } from "@/modules/external/portal/portalOrderTypes";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { ChevronDown, Download, ListOrdered, ReceiptText, Truck } from "lucide-react";
import { formatDate } from "@/shared/lib/format/formatDate";

// One order on the portal My Orders list. "View" expands the card IN PLACE —
// no page hop — with two views: Details (items, totals, address, payment,
// delivery) and Timeline (the order's journey). "Invoice" opens the A4 print
// view of the linked ONLINE_INVOICE in a new tab, where the browser's print
// dialog saves it as PDF (the unified print contract — templates stay
// customisable under Settings → Print templates).



const dt = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
        : null;

export type { PortalOrderDto };

export default function PortalOrderCard({ order }: { order: PortalOrderDto }) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<"details" | "timeline">("details");

    const grandPaise = order.goodsPaise + order.shippingPaise;
    const items = order.lines.reduce((n, l) => n + l.quantity, 0);
    const terminal =
        order.statusId === "S48" ? "Cancelled" : order.statusId === "S49" ? "Returned" : null;
    const reached = order.statusId ? STAGE_ORDER.indexOf(order.statusId) : 0;

    // `/receipt/invoice` is the staff print surface (staff login required).
    // Customers get their own ownership-checked bill view instead.
    const invoiceHref = order.invoice
        ? `/portal/orders/${order.invoice.detailId}/bill`
        : null;

    const show = (v: "details" | "timeline") => {
        if (open && view === v) setOpen(false);
        else {
            setView(v);
            setOpen(true);
        }
    };

    return (
        <Card className="border-border/70">
            <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <p className="font-medium">Order #{order.id}</p>
                        <p className="text-xs text-muted-foreground">
                            {formatDate(order.createdAt)} · {order.accountLabel}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            className={
                                order.isPaid
                                    ? "bg-green-100 text-green-700"
                                    : order.isCod
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-red-100 text-red-600"
                            }
                        >
                            {order.isPaid ? "Paid" : order.isCod ? "Pay on delivery" : "Payment pending"}
                        </Badge>
                        {order.statusLabel && (
                            <Badge
                                className={`text-xs font-medium ${order.statusColor ?? "bg-gray-100 text-gray-600"}`}
                                variant="outline"
                            >
                                {order.statusLabel}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div>
                        <p className="text-xs text-muted-foreground">Amount</p>
                        <p className="font-medium">{formatRupeesFromPaise(grandPaise)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Items</p>
                        <p className="font-medium">{items}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Delivery</p>
                        <p className="font-medium">{order.deliveryStageLabel ?? order.courierLabel ?? "—"}</p>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant={open && view === "details" ? "default" : "outline"} onClick={() => show("details")}>
                        <ReceiptText size={13} /> View details
                        <ChevronDown size={13} className={`transition-transform ${open && view === "details" ? "rotate-180" : ""}`} />
                    </Button>
                    <Button size="sm" variant={open && view === "timeline" ? "default" : "outline"} onClick={() => show("timeline")}>
                        <ListOrdered size={13} /> Timeline
                        <ChevronDown size={13} className={`transition-transform ${open && view === "timeline" ? "rotate-180" : ""}`} />
                    </Button>
                    {invoiceHref && (
                        <Button size="sm" variant="outline" asChild>
                            <a href={invoiceHref} target="_blank" rel="noreferrer">
                                <Download size={13} /> Invoice (A4 PDF)
                            </a>
                        </Button>
                    )}
                </div>

                {open && view === "details" && (
                    <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
                        {/* Items + money */}
                        <div className="text-sm">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</p>
                            <ul className="space-y-1">
                                {order.lines.map((l, i) => (
                                    <li key={i} className="flex justify-between gap-2">
                                        <span>
                                            {l.name} × {l.quantity}
                                        </span>
                                        <span>{formatRupeesFromPaise(l.amountPaise)}</span>
                                    </li>
                                ))}
                                {order.tierDiscountPaise > 0 && (
                                    <li className="flex justify-between gap-2 border-t border-border/60 pt-1 text-emerald-600 dark:text-emerald-400">
                                        <span>Level discount{order.tierLabel ? ` (${order.tierLabel})` : ""}</span>
                                        <span>−{formatRupeesFromPaise(order.tierDiscountPaise)}</span>
                                    </li>
                                )}
                                {order.couponDiscountPaise > 0 && (
                                    <li className="flex justify-between gap-2 text-emerald-600 dark:text-emerald-400">
                                        <span>Coupon{order.couponCode ? ` (${order.couponCode})` : ""}</span>
                                        <span>−{formatRupeesFromPaise(order.couponDiscountPaise)}</span>
                                    </li>
                                )}
                                {order.loyaltyRedeemPaise > 0 && (
                                    <li className="flex justify-between gap-2 text-emerald-600 dark:text-emerald-400">
                                        <span>Loyalty ({order.loyaltyRedeemPoints} pts)</span>
                                        <span>−{formatRupeesFromPaise(order.loyaltyRedeemPaise)}</span>
                                    </li>
                                )}
                                <li className="flex justify-between gap-2 border-t border-border/60 pt-1 text-muted-foreground">
                                    <span>Shipping{order.courierLabel ? ` · ${order.courierLabel}` : ""}</span>
                                    <span>{order.shippingPaise === 0 ? "FREE" : formatRupeesFromPaise(order.shippingPaise)}</span>
                                </li>
                                <li className="flex justify-between gap-2 font-semibold">
                                    <span>Total</span>
                                    <span>{formatRupeesFromPaise(grandPaise)}</span>
                                </li>
                            </ul>
                        </div>
                        {/* Address + payment + delivery */}
                        <div className="space-y-3 text-sm">
                            {order.address && (
                                <div>
                                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ship to</p>
                                    {order.shipName && <p className="font-medium">{order.shipName}</p>}
                                    <p className="text-muted-foreground">{order.address}</p>
                                </div>
                            )}
                            <div>
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
                                <p className="text-muted-foreground">
                                    {order.isCod
                                        ? "Pay on delivery"
                                        : `Online${order.gatewayLabel ? ` · ${order.gatewayLabel}` : ""}`}
                                    {order.isPaid && order.paidAt ? ` · paid ${dt(order.paidAt)}` : order.isPaid ? " · paid" : ""}
                                </p>
                            </div>
                            {(order.deliveryStageLabel || order.awb) && (
                                <div>
                                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Delivery</p>
                                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                                        <Truck size={13} />
                                        {order.courierLabel && <span>{order.courierLabel}</span>}
                                        {order.deliveryStageLabel && <span>· {order.deliveryStageLabel}</span>}
                                    </p>
                                    {order.awb && (
                                        <p className="mt-0.5 text-muted-foreground">
                                            Tracking:{" "}
                                            {order.trackingUrl ? (
                                                <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-primary underline">
                                                    {order.awb}
                                                </a>
                                            ) : (
                                                <span className="font-mono">{order.awb}</span>
                                            )}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {open && view === "timeline" && (
                    <ol className="mt-4 space-y-0 border-t border-border/60 pt-4">
                        {JOURNEY.map((step, i) => {
                            const stepIdx = STAGE_ORDER.indexOf(step.stage);
                            const done = !terminal && reached >= stepIdx;
                            const current = !terminal && order.statusId === step.stage;
                            const last = i === JOURNEY.length - 1 && !terminal;
                            // Per-step context lines
                            const detail =
                                step.stage === "S42"
                                    ? [dt(order.createdAt), order.isPaid && order.paidAt ? `Paid ${dt(order.paidAt)}${order.gatewayLabel ? ` via ${order.gatewayLabel}` : ""}` : order.isCod ? "Pay on delivery" : null]
                                    : step.stage === "S46"
                                      ? [order.shippedAt ? dt(order.shippedAt) : null, order.courierLabel, order.awb ? `AWB ${order.awb}` : null]
                                      : step.stage === "S47"
                                        ? [order.deliveredAt ? dt(order.deliveredAt) : null]
                                        : [];
                            // Live courier movement shows under Dispatched while in transit.
                            const courierNow =
                                step.stage === "S46" && !done && order.deliveryStageLabel && reached >= STAGE_ORDER.indexOf("S45")
                                    ? order.deliveryStageLabel
                                    : null;
                            return (
                                <li key={step.stage} className="relative flex gap-3 pb-5 last:pb-0">
                                    {!last && (
                                        <span
                                            className={`absolute left-[5px] top-4 h-full w-0.5 ${done ? "bg-primary" : "bg-border"}`}
                                            aria-hidden
                                        />
                                    )}
                                    <span
                                        className={`relative mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${
                                            done ? "border-primary bg-primary" : current ? "border-primary bg-background" : "border-border bg-background"
                                        }`}
                                        aria-hidden
                                    />
                                    <div className="text-sm">
                                        <p className={done || current ? "font-medium" : "text-muted-foreground"}>{step.label}</p>
                                        {detail.filter(Boolean).map((d, j) => (
                                            <p key={j} className="text-xs text-muted-foreground">{d}</p>
                                        ))}
                                        {courierNow && <p className="text-xs text-primary">{courierNow}</p>}
                                    </div>
                                </li>
                            );
                        })}
                        {terminal && (
                            <li className="relative flex gap-3">
                                <span className="relative mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-red-500 bg-red-500" aria-hidden />
                                <div className="text-sm">
                                    <p className="font-medium text-red-600">{terminal}</p>
                                </div>
                            </li>
                        )}
                    </ol>
                )}
            </CardContent>
        </Card>
    );
}
