"use client";

import Link from "next/link";
import { Check, FileText, MapPin, Truck, X } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import OnlinePayPanel from "@/modules/external/shop/OnlinePayPanel";
import { JOURNEY, STAGE_ORDER, type PortalOrderDto } from "@/modules/external/portal/portalOrderTypes";
import { orderHeadline } from "@/modules/external/shopApp/appOrderStatus";
import { APP } from "@/modules/external/shopApp/appPaths";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";

/**
 * One order, the way shopping apps show it: where it is now in big type, the
 * tracking timeline (placed → confirmed → packing → dispatched → delivered),
 * the items, the price details, the address and payment, and the invoice once
 * posted. Unpaid online orders get the website's own payment panel (Pay now).
 */
export default function AppOrderView({
    order: o,
    gateways,
    payFailed,
}: {
    order: PortalOrderDto;
    gateways: { provider: string; displayName: string }[];
    payFailed: boolean;
}) {
    const head = orderHeadline(o);
    const grand = o.goodsPaise + o.shippingPaise;
    const terminal = o.statusId === "S48" || o.statusId === "S49";
    const reached = o.statusId ? STAGE_ORDER.indexOf(o.statusId) : 0;
    const when = (iso: string | null) =>
        iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;
    const stepTime: Record<string, string | null> = { S42: when(o.createdAt), S46: when(o.shippedAt), S47: when(o.deliveredAt) };
    const autoLaunch = o.awaitingPayment && !payFailed && !!o.onlineProvider && gateways.some((g) => g.provider === o.onlineProvider);

    return (
        <>
            <MobileHeader title={`Order #${o.id}`} back={`${APP}/orders`} />
            <div className="space-y-2 py-2">
                <section className="bg-background px-4 py-4">
                    <p className={`text-lg font-semibold ${head.tone}`}>{head.text}</p>
                    <p className="text-xs text-muted-foreground">
                        Placed {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {o.accountLabel}
                    </p>
                </section>

                {o.awaitingPayment && (
                    <section className="space-y-3 bg-background px-4 py-4">
                        {payFailed && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Payment was not completed. You can try again.</p>}
                        {gateways.length > 0 ? (
                            <OnlinePayPanel orderId={o.id} amountLabel={formatRupeesFromPaise(grand)} gateways={gateways} chosen={o.onlineProvider} autoLaunch={autoLaunch} />
                        ) : (
                            <p className="text-sm text-muted-foreground">Online payment is not available right now. Please call the shop.</p>
                        )}
                    </section>
                )}

                <section className="bg-background px-4 py-4">
                    {terminal ? (
                        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                            <X className="size-4" /> {o.statusId === "S48" ? "This order was cancelled." : "This order was returned."}
                        </p>
                    ) : (
                        <ol>
                            {JOURNEY.map((step, i) => {
                                const done = reached >= STAGE_ORDER.indexOf(step.stage);
                                const last = i === JOURNEY.length - 1;
                                return (
                                    <li key={step.stage} className="relative flex gap-3 pb-5 last:pb-0">
                                        {!last && <span className={`absolute left-[11px] top-6 h-[calc(100%-1rem)] w-0.5 ${done ? "bg-emerald-600" : "bg-border"}`} />}
                                        <span
                                            className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ${
                                                done ? "bg-emerald-600 text-white" : "border-2 border-border bg-background"
                                            }`}
                                        >
                                            {done && <Check className="size-3.5" />}
                                        </span>
                                        <span className="min-w-0">
                                            <span className={`block text-sm ${done ? "font-medium" : "text-muted-foreground"}`}>{step.label}</span>
                                            {done && stepTime[step.stage] && <span className="block text-xs text-muted-foreground">{stepTime[step.stage]}</span>}
                                            {step.stage === "S46" && o.deliveryStageLabel && <span className="block text-xs text-muted-foreground">{o.deliveryStageLabel}</span>}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                    {(o.courierLabel || o.awb) && (
                        <p className="mt-4 flex items-center gap-2 border-t pt-3 text-sm">
                            <Truck className="size-4 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                                {o.courierLabel}
                                {o.awb && <span className="block font-mono text-xs text-muted-foreground">{o.awb}</span>}
                            </span>
                            {o.trackingUrl && (
                                <a href={o.trackingUrl} className="text-sm font-medium text-primary">
                                    Track
                                </a>
                            )}
                        </p>
                    )}
                </section>

                <section className="bg-background px-4 py-4 text-sm">
                    <h2 className="mb-2 text-base font-semibold">Items</h2>
                    <ul className="space-y-2">
                        {o.lines.map((l, i) => (
                            <li key={i} className="flex justify-between gap-3">
                                <span className="min-w-0">
                                    {l.name} <span className="text-muted-foreground">× {l.quantity}</span>
                                </span>
                                <span className="shrink-0 tabular-nums">{formatRupeesFromPaise(l.amountPaise)}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="space-y-2 bg-background px-4 py-4 text-sm">
                    <h2 className="text-base font-semibold">Price details</h2>
                    {o.tierDiscountPaise > 0 && <Line k={`Level discount${o.tierLabel ? ` (${o.tierLabel})` : ""}`} v={`−${formatRupeesFromPaise(o.tierDiscountPaise)}`} good />}
                    {o.couponDiscountPaise > 0 && <Line k={`Coupon${o.couponCode ? ` (${o.couponCode})` : ""}`} v={`−${formatRupeesFromPaise(o.couponDiscountPaise)}`} good />}
                    {o.loyaltyRedeemPaise > 0 && <Line k={`Points (${o.loyaltyRedeemPoints})`} v={`−${formatRupeesFromPaise(o.loyaltyRedeemPaise)}`} good />}
                    <Line k="Items" v={formatRupeesFromPaise(o.goodsPaise)} />
                    <Line k="Delivery" v={o.shippingPaise === 0 ? "FREE" : formatRupeesFromPaise(o.shippingPaise)} />
                    <div className="flex justify-between border-t pt-2 text-base font-semibold">
                        <span>{o.isPaid ? "Total paid" : "Total"}</span>
                        <span className="tabular-nums">{formatRupeesFromPaise(grand)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {o.isPaid ? `Paid${o.gatewayLabel ? ` · ${o.gatewayLabel}` : ""}` : o.isCod ? "Pay on delivery" : "Online payment pending"}
                    </p>
                </section>

                {o.address && (
                    <section className="bg-background px-4 py-4 text-sm">
                        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
                            <MapPin className="size-4" /> Delivery address
                        </h2>
                        {o.shipName && <p className="font-medium">{o.shipName}</p>}
                        <p className="text-muted-foreground">{o.address}</p>
                    </section>
                )}

                {o.invoice && (
                    <Link href={`${APP}/bill/${o.invoice.detailId}`} className="flex items-center gap-3 bg-background px-4 py-4 text-sm active:bg-muted">
                        <FileText className="size-5 text-primary" />
                        <span className="flex-1">
                            Invoice {o.invoice.voucherNo}
                            <span className="block text-xs text-muted-foreground">GST invoice for this order</span>
                        </span>
                    </Link>
                )}
            </div>
        </>
    );
}

function Line({ k, v, good }: { k: string; v: string; good?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 ${good ? "text-emerald-700" : ""}`}>
            <span className="min-w-0">{k}</span>
            <span className="shrink-0 tabular-nums">{v}</span>
        </div>
    );
}
