import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import OrderParcelLabel, { type ParcelLabelData, type ParcelLabelSize } from "@/shared/components/print/OrderParcelLabel";

// Parcel label for a shop order shipped by OUR couriers (local delivery /
// Standard courier) — DELIVERY_SHIPPING_LABEL template kind (customisable in
// Settings → Print Templates). Aggregator shipments (Shiprocket / Shipway)
// print the carrier's own PDF from the order page instead — never this.
const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

type AddrJson = {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string | null;
    neighbourhood?: string | null;
    locality?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    courierService?: string;
};

export default async function OrderParcelLabelPage({
    params,
    searchParams,
}: {
    params: Promise<{ orderId: string }>;
    searchParams?: Promise<{ autoprint?: string; size?: string }>;
}) {
    const { orderId } = await params;
    const sp = (await searchParams) ?? {};
    const oid = Number(orderId);
    const initialSize: ParcelLabelSize =
        sp.size === "A4" || sp.size === "THERMAL" || sp.size === "TL100x150" ? sp.size : "TL100x150";

    const t = await prisma.ticket.findUnique({
        where: { id: oid },
        select: {
            id: true,
            createdAt: true,
            order: {
                select: {
                    paymentMethod: true,
                    paidAt: true,
                    legacyStatus: true,
                    totalPaise: true,
                    shippingChargePaise: true,
                    courier: true,
                    trackingNumber: true,
                    shippingName: true,
                    shippingAddress: true,
                    lines: { select: { quantity: true, product: { select: { weightGrams: true } } } },
                },
            },
        },
    });
    if (!t?.order) notFound();
    const o = t.order;
    const addr = (o.shippingAddress ?? {}) as AddrJson;

    const delivery = await prisma.ticketDelivery.findFirst({
        where: { orderSource: "shop", orderId: oid },
        select: { awb: true },
    });

    // FROM — our shop identity, from the customisable label template.
    const template = await getVoucherTemplate("DELIVERY_SHIPPING_LABEL");
    const from = {
        name: template.headerLine1 || COMPANY_DETAILS.brandName,
        address: template.addressBlock?.trim() || null,
        phone: template.phoneLine?.replace(/^Ph:\s*/i, "").trim() || null,
    };

    const toAddress = [
        [addr.line1, addr.line2].filter(Boolean).join(", "),
        [addr.neighbourhood, addr.locality].filter(Boolean).join(", "),
        [addr.city, addr.state].filter(Boolean).join(", "),
    ]
        .filter(Boolean)
        .join("\n");

    const grandPaise = o.totalPaise + (o.shippingChargePaise ?? 0);
    const cod = o.paymentMethod === "COD" && o.legacyStatus !== "PAID" && !o.paidAt;
    const weightGrams = o.lines.reduce(
        (g, l) => g + (l.product.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * l.quantity,
        0,
    );

    const data: ParcelLabelData = {
        from,
        to: {
            name: addr.name || o.shippingName || "Customer",
            address: toAddress || null,
            phone: addr.phone ?? null,
            pincode: addr.pincode ?? null,
        },
        orderNo: `WEB-${t.id}`,
        date: formatDate(t.createdAt),
        courier: addr.courierService ?? o.courier ?? "Courier",
        awb: delivery?.awb ?? o.trackingNumber,
        payment: { cod, amountLabel: cod ? formatRupeesFromPaise(grandPaise) : null },
        weightGrams,
        items: o.lines.reduce((n, l) => n + l.quantity, 0),
        footer: template.footerLine?.trim() || null,
    };

    return <OrderParcelLabel data={data} autoPrint={sp.autoprint !== "0"} initialSize={initialSize} />;
}
