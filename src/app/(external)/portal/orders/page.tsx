import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPortalAccountOptions } from "@/shared/lib/auth/portalAccountContext";
import { DELIVERY_STAGE_LABEL } from "@/modules/delivery/lib/shiprocketStatus";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalOrderCard, { type PortalOrderDto } from "@/modules/external/portal/PortalOrderCard";
import { ShoppingBag } from "lucide-react";

// The customer's REAL orders across every profile they belong to (personal +
// linked company accounts) — an order is a Ticket (flavour "order") +
// TicketOrder detail. Each card expands IN PLACE (details / timeline) and the
// posted ONLINE_INVOICE downloads as an A4 PDF via the print-template view.

const GATEWAY_LABEL: Record<string, string> = {
    razorpay: "Razorpay",
    payu: "PayU",
    cashfree: "Cashfree",
    demo: "Demo gateway",
};

type AddrJson = {
    line1?: string;
    line2?: string | null;
    neighbourhood?: string | null;
    locality?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    courierService?: string;
    onlineProvider?: string | null;
};

export default async function PortalOrdersPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect("/login?callbackUrl=/portal/orders");
    }

    // Every account this customer can act for (personal first, then companies).
    const accountOptions = await getPortalAccountOptions(customerId);
    const accountLabel = new Map(accountOptions.map((o) => [o.accountId, o.label]));
    const accountIds = accountOptions.map((o) => o.accountId);

    const tickets = await prisma.ticket.findMany({
        where: {
            order: { isNot: null },
            OR: [
                { accountId: { in: accountIds.length > 0 ? accountIds : [-1] } },
                { order: { personId: customerId } },
            ],
        },
        orderBy: { id: "desc" },
        take: 100,
        select: {
            id: true,
            accountId: true,
            status: true,
            createdAt: true,
            ticketStatus: { select: { label: true, color: true } },
            order: {
                select: {
                    legacyStatus: true,
                    paymentMethod: true,
                    paidAt: true,
                    shippedAt: true,
                    deliveredAt: true,
                    totalPaise: true,
                    shippingChargePaise: true,
                    tierDiscountPaise: true,
                    tierLabel: true,
                    couponCode: true,
                    couponDiscountPaise: true,
                    loyaltyRedeemPoints: true,
                    loyaltyRedeemPaise: true,
                    courier: true,
                    trackingNumber: true,
                    shippingName: true,
                    shippingAddress: true,
                    lines: {
                        select: {
                            quantity: true,
                            unitPricePaise: true,
                            product: { select: { name: true } },
                        },
                    },
                },
            },
        },
    });
    const orders = tickets.filter((t) => t.order != null);
    const orderIds = orders.map((t) => t.id);

    // Live delivery stage (P8) + linked posted invoice for all orders, batched.
    const [deliveries, invLinks] = await Promise.all([
        prisma.ticketDelivery.findMany({
            where: { orderSource: "shop", orderId: { in: orderIds } },
            select: { orderId: true, awb: true, trackingUrl: true, ticket: { select: { status: true } } },
        }),
        prisma.voucherLink.findMany({
            where: { kind: "SHOP_ORDER", targetId: { in: orderIds.map(String) } },
            select: { targetId: true, universalVoucherId: true },
        }),
    ]);
    const deliveryByOrder = new Map(deliveries.map((d) => [d.orderId, d]));

    const invSpines = invLinks.length
        ? await prisma.universalVoucher.findMany({
              where: {
                  id: { in: invLinks.map((l) => l.universalVoucherId) },
                  status: "POSTED",
              },
              select: {
                  id: true,
                  voucherNo: true,
                  voucherDetail: { select: { id: true, placeOfSupply: true } },
              },
          })
        : [];
    const spineById = new Map(invSpines.map((s) => [s.id, s]));
    // orderId → latest posted linked invoice.
    const invoiceByOrder = new Map<number, { detailId: number; voucherNo: string; placeOfSupply: string | null }>();
    for (const l of invLinks) {
        const s = spineById.get(l.universalVoucherId);
        if (!s?.voucherDetail) continue;
        const oid = Number(l.targetId);
        const prev = invoiceByOrder.get(oid);
        if (!prev || s.voucherDetail.id > prev.detailId) {
            invoiceByOrder.set(oid, {
                detailId: s.voucherDetail.id,
                voucherNo: s.voucherNo ?? `#${s.voucherDetail.id}`,
                placeOfSupply: s.voucherDetail.placeOfSupply,
            });
        }
    }

    const dtos: PortalOrderDto[] = orders.map((t) => {
        const o = t.order!;
        const addr = (o.shippingAddress ?? {}) as AddrJson;
        const delivery = deliveryByOrder.get(t.id);
        const address = [
            [addr.line1, addr.line2, addr.neighbourhood, addr.locality].filter(Boolean).join(", "),
            [addr.city, addr.state, addr.pincode].filter(Boolean).join(", "),
        ]
            .filter(Boolean)
            .join(" · ");
        return {
            id: t.id,
            createdAt: t.createdAt.toISOString(),
            accountLabel: accountLabel.get(t.accountId ?? -1) ?? "Personal",
            statusId: t.status,
            statusLabel: t.ticketStatus?.label ?? null,
            statusColor: t.ticketStatus?.color ?? null,
            isPaid: o.legacyStatus === "PAID" || !!o.paidAt,
            isCod: o.paymentMethod === "COD",
            paidAt: o.paidAt?.toISOString() ?? null,
            gatewayLabel: addr.onlineProvider ? GATEWAY_LABEL[addr.onlineProvider] ?? addr.onlineProvider : null,
            goodsPaise: o.totalPaise,
            shippingPaise: o.shippingChargePaise ?? 0,
            tierDiscountPaise: o.tierDiscountPaise,
            tierLabel: o.tierLabel,
            couponDiscountPaise: o.couponDiscountPaise,
            couponCode: o.couponCode,
            loyaltyRedeemPaise: o.loyaltyRedeemPaise,
            loyaltyRedeemPoints: o.loyaltyRedeemPoints,
            lines: o.lines.map((l) => ({
                name: l.product.name,
                quantity: l.quantity,
                amountPaise: l.unitPricePaise * l.quantity,
            })),
            address: address || null,
            shipName: o.shippingName,
            courierLabel: addr.courierService ?? o.courier,
            deliveryStageLabel: delivery ? DELIVERY_STAGE_LABEL[delivery.ticket.status] ?? null : null,
            awb: delivery?.awb ?? o.trackingNumber,
            trackingUrl: delivery?.trackingUrl ?? null,
            shippedAt: o.shippedAt?.toISOString() ?? null,
            deliveredAt: o.deliveredAt?.toISOString() ?? null,
            invoice: invoiceByOrder.get(t.id) ?? null,
        };
    });

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Orders"
                    description="Track your purchases across personal and company profiles."
                    icon={ShoppingBag}
                    rightSlot={<Button variant="outline" asChild><Link href="/shop">New order</Link></Button>}
                />

                {dtos.length === 0 ? (
                    <Card>
                        <CardContent className="py-14 text-center text-sm text-muted-foreground">
                            No orders yet.{" "}
                            <Link href="/shop" className="text-primary underline">Browse the shop</Link> to place your first one.
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {dtos.map((o) => (
                            <PortalOrderCard key={o.id} order={o} />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
