// SERVER-ONLY. Pushes a P8 Delivery to Shiprocket: create the shipment from the
// order's address + lines, assign an AWB, schedule pickup, fetch the label — then
// stamp the AWB / tracking URL / Shiprocket ids back onto the TicketDelivery and
// move the delivery to "Carrier Assigned". Shop orders only (an inv order has no
// stored shipping address). Requires the SHIPROCKET DeliveryMethod config +
// SHIPROCKET_EMAIL/PASSWORD env — the caller checks shiprocketEnvReady() first.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadDeliveryMethod, type ShiprocketConfig } from "./deliveryMethods";
import {
    shiprocketCreateAdhoc,
    shiprocketAssignAwb,
    shiprocketGeneratePickup,
    shiprocketGenerateLabel,
    type SrAdhocItem,
} from "./shiprocket";
import { DELIVERY_STAGE } from "./shiprocketStatus";

type ShipAddress = {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    // Checkout snapshot — the specific Shiprocket courier the customer picked
    // (or staff changed to). Passed to AWB assignment so the booked courier is
    // the chosen one, not Shiprocket's auto-pick.
    shiprocketCourierId?: number | null;
};

export type ShiprocketPushResult = { awb: string; courierName: string | null; labelUrl: string | null; trackingUrl: string };

export async function pushDeliveryToShiprocket(deliveryTicketId: number): Promise<ShiprocketPushResult> {
    const del = await prisma.ticketDelivery.findUnique({
        where: { ticketId: deliveryTicketId },
        select: { ticketId: true, orderSource: true, orderId: true, addressJson: true, awb: true, shipmentId: true },
    });
    if (!del) throw new Error("Delivery not found");
    if (del.awb) throw new Error("This delivery already has an AWB");
    if (del.orderSource !== "shop") throw new Error("Shiprocket push supports online orders only");

    const [order, method] = await Promise.all([
        prisma.ticketOrder.findUnique({
            where: { ticketId: del.orderId },
            select: {
                totalPaise: true,
                paymentMethod: true,
                shippingAddress: true,
                lines: { select: { quantity: true, unitPricePaise: true, product: { select: { sku: true, name: true, weightGrams: true } } } },
            },
        }),
        loadDeliveryMethod("SHIPROCKET"),
    ]);
    if (!order) throw new Error("Order not found");
    if (!method) throw new Error("Shiprocket is not configured under Settings → Couriers");

    const cfg = method.configJson as ShiprocketConfig;
    if (!cfg.pickupLocation || !cfg.pickupPincode) {
        throw new Error("Set the Shiprocket pickup location + pincode under Settings → Couriers");
    }

    // Address: prefer the delivery's snapshot, fall back to the order's.
    const addr = ((del.addressJson ?? order.shippingAddress) ?? {}) as ShipAddress;
    if (!addr.pincode || !addr.line1 || !addr.name || !addr.phone) {
        throw new Error("The order has no complete shipping address");
    }
    // Shiprocket validates phone as EXACTLY 10 digits — customers type "0…" or
    // "+91…" prefixes, so keep the last 10 digits of whatever was entered.
    const phone10 = String(addr.phone).replace(/\D/gu, "").slice(-10);
    if (phone10.length !== 10) {
        throw new Error(`The shipping phone "${addr.phone}" is not a valid 10-digit mobile number`);
    }
    // Shiprocket REQUIRES billing_last_name to be present — split the customer's
    // name on the final space ("Akramul Jakir" → "Akramul" + "Jakir"); a
    // single-word name sends an empty last name (present, just blank).
    const nameParts = String(addr.name).trim().split(/\s+/u);
    const firstName = nameParts.slice(0, -1).join(" ") || nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    const fallbackWeight = Number(cfg.defaultItemWeightGrams) || 500;
    let grams = 0;
    const items: SrAdhocItem[] = order.lines.map((l) => {
        grams += (l.product.weightGrams ?? fallbackWeight) * l.quantity;
        return {
            name: l.product.name,
            sku: l.product.sku,
            units: l.quantity,
            selling_price: Math.round(l.unitPricePaise / 100),
        };
    });
    const weightKg = Math.max(0.05, grams / 1000);

    // Reuse the shipment from an earlier failed attempt (e.g. AWB refused on
    // wallet balance) — re-creating would duplicate the order inside Shiprocket.
    let shipmentId = del.shipmentId;
    if (!shipmentId) {
        const created = await shiprocketCreateAdhoc({
            order_id: `WEB-${del.orderId}`,
            order_date: new Date().toISOString().slice(0, 10),
            pickup_location: String(cfg.pickupLocation),
            billing_customer_name: firstName,
            billing_last_name: lastName,
            billing_address: [addr.line1, addr.line2].filter(Boolean).join(", "),
            billing_city: String(addr.city ?? ""),
            billing_pincode: String(addr.pincode),
            billing_state: String(addr.state ?? ""),
            billing_country: "India",
            billing_phone: phone10,
            shipping_is_billing: true,
            order_items: items,
            payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",
            sub_total: Math.round(order.totalPaise / 100),
            length: Number(cfg.length) || 15,
            breadth: Number(cfg.breadth) || 15,
            height: Number(cfg.height) || 10,
            weight: Number(weightKg.toFixed(2)),
        });
        shipmentId = created.shipmentId;
        // Stamp NOW — before AWB assignment — so a failure below never orphans
        // the Shiprocket-side order and a retry picks it back up.
        await prisma.ticketDelivery.update({
            where: { ticketId: deliveryTicketId },
            data: { carrier: "SHIPROCKET", shiprocketOrderId: created.orderId || null, shipmentId },
        });
    }

    const chosenCourierId = Number(addr.shiprocketCourierId) || undefined;
    const { awb, courierName } = await shiprocketAssignAwb(shipmentId, chosenCourierId);
    // Pickup + label are best-effort — a failure here shouldn't lose the AWB.
    await shiprocketGeneratePickup(shipmentId).catch(() => undefined);
    const label = await shiprocketGenerateLabel(shipmentId).catch(() => ({ labelUrl: null }));

    const trackingUrl = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
    await prisma.ticketDelivery.update({
        where: { ticketId: deliveryTicketId },
        data: { awb, trackingUrl },
    });
    // Mirror the AWB onto the shop order so its header + "Mark Dispatched" fields
    // carry it (both the auto-book and the manual book-now paths land here).
    await prisma.ticketOrder
        .update({ where: { ticketId: del.orderId }, data: { trackingNumber: awb } })
        .catch(() => undefined);
    // Advance the delivery to "Carrier Assigned".
    await prisma.ticket.update({ where: { id: deliveryTicketId }, data: { status: DELIVERY_STAGE.CARRIER_ASSIGNED } });

    return { awb, courierName, labelUrl: label.labelUrl, trackingUrl };
}
