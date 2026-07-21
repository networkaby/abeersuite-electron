import Link from "next/link";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getActiveOnlineGateway } from "@/shared/lib/payments/activeOnlineGateway";
import SimulatePaymentButton from "@/modules/external/shop/SimulatePaymentButton";

// Coarse delivery-stage labels (P8) mapped from the seeded status ids, so the
// customer sees a friendly line without us leaking internal stage codes.
const DELIVERY_STAGE_LABEL: Record<string, string> = {
    S50: "Preparing to dispatch",
    S51: "Courier assigned",
    S52: "Picked up",
    S53: "In transit",
    S54: "Out for delivery",
    S55: "Delivered",
    S56: "Delivery failed / returned",
};

export default async function ShopOrderConfirmationPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
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
            courier: true,
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

    // Delivery card for this order (P8), if one has been spawned.
    const delivery = await prisma.ticketDelivery.findFirst({
        where: { orderSource: "shop", orderId },
        select: { carrier: true, awb: true, trackingUrl: true, ticket: { select: { status: true } } },
    });

    const grand = order.totalPaise + order.shippingChargePaise;
    const unpaidOnline = order.paymentMethod === "ONLINE" && order.legacyStatus === "PENDING_PAYMENT";
    const gateway = await getActiveOnlineGateway();
    const showSimulate = unpaidOnline && gateway?.provider === "demo";

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
                    {showSimulate
                        ? "This order is awaiting payment. Use the floating button to simulate a successful payment."
                        : "This order is awaiting online payment."}
                </p>
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
                <li className="flex justify-between gap-2 border-t border-border pt-1 mt-1 text-muted-foreground">
                    <span>Shipping{order.courier ? ` · ${order.courier}` : ""}</span>
                    <span>{order.shippingChargePaise === 0 ? "FREE" : formatRupeesFromPaise(order.shippingChargePaise)}</span>
                </li>
            </ul>

            <p className="font-semibold flex justify-between">
                <span>{order.legacyStatus === "PAID" ? "Total paid" : "Total due"}</span>
                <span>{formatRupeesFromPaise(grand)}</span>
            </p>

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

            {showSimulate ? <SimulatePaymentButton orderId={order.ticketId} /> : null}
        </main>
    );
}
