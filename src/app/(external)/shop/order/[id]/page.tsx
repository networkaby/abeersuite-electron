import Link from "next/link";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPayableOnlineGateways } from "@/shared/lib/payments/activeOnlineGateway";
import OnlinePayPanel from "@/modules/external/shop/OnlinePayPanel";
import { DELIVERY_STAGE_LABEL } from "@/modules/delivery/lib/shiprocketStatus";

export default async function ShopOrderConfirmationPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ pay?: string }>;
}) {
    const { id } = await params;
    const { pay } = await searchParams;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) {
        return (
            <main className="mx-auto max-w-lg px-4 py-8">
                <p>Invalid order.</p>
            </main>
        );
    }

    // An order is a Ticket (flavour "order") + TicketOrder detail (keyed by ticketId).
    const order = await prisma.ticketOrder.findUnique({
        where: { ticketId: orderId },
        select: {
            ticketId: true,
            legacyStatus: true,
            paymentMethod: true,
            paidAt: true,
            totalPaise: true,
            shippingChargePaise: true,
            tierDiscountPaise: true,
            tierLabel: true,
            couponCode: true,
            couponDiscountPaise: true,
            loyaltyRedeemPoints: true,
            loyaltyRedeemPaise: true,
            courier: true,
            shippingAddress: true,
            trackingNumber: true,
            shippingName: true,
            lines: { include: { product: { select: { name: true } } } },
        },
    });

    if (!order) {
        return (
            <main className="mx-auto max-w-lg px-4 py-8">
                <p>Order not found.</p>
            </main>
        );
    }

    // Friendly courier name the customer picked (the service/courier), falling
    // back to the raw kind for older orders.
    const courierLabel =
        (order.shippingAddress as { courierService?: string } | null)?.courierService ?? order.courier ?? null;
    // Store pickup — the store's note (address / timings) snapshotted at checkout.
    const isStorePickup = order.courier === "STORE_PICKUP";
    const pickupNote = isStorePickup
        ? (order.shippingAddress as { pickupNote?: string } | null)?.pickupNote ?? null
        : null;

    // Delivery card for this order (P8), if one has been spawned.
    const delivery = await prisma.ticketDelivery.findFirst({
        where: { orderSource: "shop", orderId },
        select: { carrier: true, awb: true, trackingUrl: true, ticket: { select: { status: true } } },
    });

    const grand = order.totalPaise + order.shippingChargePaise;
    const unpaidOnline = order.paymentMethod === "ONLINE" && order.legacyStatus === "PENDING_PAYMENT";
    // Every enabled online gateway is offered as its own pay option; the one chosen
    // at checkout (snapshot on the order) is pre-selected.
    const gateways = unpaidOnline ? await getPayableOnlineGateways() : [];
    const chosenProvider =
        (order.shippingAddress as { onlineProvider?: string } | null)?.onlineProvider ?? null;
    const payFailed = pay === "failed";
    // Auto-launch the pre-chosen gateway on first arrival (skip the picker); on a
    // failed/cancelled return, show the picker so they can retry or switch.
    const autoLaunch =
        unpaidOnline && !payFailed && !!chosenProvider && gateways.some((g) => g.provider === chosenProvider);

    return (
        <main className="mx-auto max-w-lg px-4 py-8 space-y-5">
            <div>
                <h1 className="text-2xl font-semibold">Order #{order.ticketId}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={order.legacyStatus === "PAID" ? "default" : "secondary"}>
                        {order.legacyStatus === "PAID"
                            ? "Paid"
                            : order.paymentMethod === "COD"
                              ? "Pay on delivery"
                              : "Payment pending"}
                    </Badge>
                    {order.paidAt ? (
                        <span className="text-muted-foreground text-xs">
                            Paid on {order.paidAt.toLocaleDateString("en-IN")}
                        </span>
                    ) : null}
                </div>
            </div>

            {unpaidOnline ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    {autoLaunch
                        ? "This order is awaiting online payment. Taking you to the payment page…"
                        : gateways.length > 0
                          ? "This order is awaiting online payment. Choose how to pay below."
                          : "This order is awaiting online payment."}
                </p>
            ) : null}

            {payFailed ? (
                <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                    Payment was not completed. You can try again below.
                </p>
            ) : null}

            {unpaidOnline && gateways.length > 0 ? (
                <OnlinePayPanel
                    orderId={order.ticketId}
                    amountLabel={formatRupeesFromPaise(grand)}
                    gateways={gateways}
                    chosen={chosenProvider}
                    autoLaunch={autoLaunch}
                />
            ) : null}

            <ul className="text-sm space-y-1 border border-border rounded-lg p-3">
                {order.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                        <span>
                            {l.product.name} × {l.quantity}
                        </span>
                        <span>{formatRupeesFromPaise(l.unitPricePaise * l.quantity)}</span>
                    </li>
                ))}
                {order.tierDiscountPaise > 0 && (
                    <li className="flex justify-between gap-2 border-t border-border pt-1 mt-1 text-emerald-600 dark:text-emerald-400">
                        {/* Frozen level discount — line prices above are the gross tags;
                            totalPaise is already net of this. */}
                        <span>Level discount{order.tierLabel ? ` (${order.tierLabel})` : ""}</span>
                        <span>−{formatRupeesFromPaise(order.tierDiscountPaise)}</span>
                    </li>
                )}
                {order.couponDiscountPaise > 0 && (
                    <li className="flex justify-between gap-2 border-t border-border pt-1 mt-1 text-emerald-600 dark:text-emerald-400">
                        <span>Coupon{order.couponCode ? ` (${order.couponCode})` : ""}</span>
                        <span>−{formatRupeesFromPaise(order.couponDiscountPaise)}</span>
                    </li>
                )}
                {order.loyaltyRedeemPaise > 0 && (
                    <li className="flex justify-between gap-2 border-t border-border pt-1 mt-1 text-emerald-600 dark:text-emerald-400">
                        <span>Loyalty ({order.loyaltyRedeemPoints} pts)</span>
                        <span>−{formatRupeesFromPaise(order.loyaltyRedeemPaise)}</span>
                    </li>
                )}
                <li className="flex justify-between gap-2 border-t border-border pt-1 mt-1 text-muted-foreground">
                    <span>Shipping{courierLabel ? ` · ${courierLabel}` : ""}</span>
                    <span>{order.shippingChargePaise === 0 ? "FREE" : formatRupeesFromPaise(order.shippingChargePaise)}</span>
                </li>
            </ul>

            <p className="font-semibold flex justify-between">
                <span>{order.legacyStatus === "PAID" ? "Total paid" : "Total due"}</span>
                <span>{formatRupeesFromPaise(grand)}</span>
            </p>

            {isStorePickup ? (
                <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                    <p className="font-medium">Pickup from store</p>
                    <p className="text-muted-foreground">
                        {pickupNote || "Collect your order from our store once it's ready."}
                    </p>
                </div>
            ) : null}

            {delivery ? (
                <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                    <p className="font-medium">Delivery</p>
                    <p className="text-muted-foreground">
                        {DELIVERY_STAGE_LABEL[delivery.ticket.status] ?? "Processing"}
                        {delivery.carrier ? ` · ${delivery.carrier}` : ""}
                    </p>
                    {delivery.awb ? (
                        <p className="text-muted-foreground">
                            Tracking: {delivery.trackingUrl ? (
                                <a href={delivery.trackingUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                                    {delivery.awb}
                                </a>
                            ) : (
                                <span className="font-mono">{delivery.awb}</span>
                            )}
                        </p>
                    ) : null}
                </div>
            ) : null}

            <Button variant="outline" asChild>
                <Link href="/shop">Continue shopping</Link>
            </Button>
        </main>
    );
}
