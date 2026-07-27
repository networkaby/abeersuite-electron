// SERVER-ONLY. Pushes a P8 Delivery to Shipway: one v2orders call creates the
// order, assigns the AWB on the chosen carrier, and returns the label — then a
// best-effort pickup request, and the AWB / label / ids are stamped back onto
// the TicketDelivery + order and the delivery moves to "Carrier Assigned".
// Shop orders only. Requires the SHIPWAY DeliveryMethod config (pickup pincode
// → resolves the Shipway warehouse) + SHIPWAY_USERNAME/SHIPWAY_LICENSE env —
// the caller checks shipwayEnvReady() first.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadDeliveryMethod, type ShipwayConfig } from "./deliveryMethods";
import {
    shipwayGetWarehouses,
    shipwayCreateOrderWithLabel,
    shipwayCreatePickup,
    shipwayTrackByAwb,
    type ShipwayOrderItem,
} from "./shipway";
import { DELIVERY_STAGE } from "./shiprocketStatus";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

type ShipAddress = {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    // Checkout snapshot — "shipway:{methodId}:{carrierId}" identifies the exact
    // Shipway carrier the customer picked (or staff changed to).
    courierOptionId?: string;
};

export type ShipwayPushResult = { awb: string; courierName: string | null; labelUrl: string | null; trackingUrl: string | null };

/** Resolve the Shipway warehouse to ship from: config override → pincode match →
 *  the only warehouse on the account. Throws a setup-guiding error otherwise. */
async function resolveWarehouseId(cfg: ShipwayConfig & { warehouseId?: string | number }): Promise<string> {
    const override = String(cfg.warehouseId ?? "").trim();
    if (override) return override;
    const list = await shipwayGetWarehouses();
    if (list.length === 0) {
        throw new Error("No warehouse exists in the Shipway account — create one under Shipway → Settings → Warehouse");
    }
    const byPin = cfg.pickupPincode ? list.find((w) => w.pincode === String(cfg.pickupPincode)) : undefined;
    if (byPin) return byPin.warehouseId;
    if (list.length === 1) return list[0].warehouseId;
    throw new Error(
        `Set the Shipway pickup pincode to match a warehouse — account has: ${list
            .map((w) => `${w.title} (#${w.warehouseId}, ${w.pincode})`)
            .join(", ")}`,
    );
}

export async function pushDeliveryToShipway(deliveryTicketId: number): Promise<ShipwayPushResult> {
    const del = await prisma.ticketDelivery.findUnique({
        where: { ticketId: deliveryTicketId },
        select: { ticketId: true, orderSource: true, orderId: true, addressJson: true, awb: true },
    });
    if (!del) throw new Error("Delivery not found");
    if (del.awb) throw new Error("This delivery already has an AWB");
    if (del.orderSource !== "shop") throw new Error("Shipway push supports online orders only");

    const [order, method] = await Promise.all([
        prisma.ticketOrder.findUnique({
            where: { ticketId: del.orderId },
            select: {
                totalPaise: true,
                shippingChargePaise: true,
                paymentMethod: true,
                shippingAddress: true,
                lines: { select: { quantity: true, unitPricePaise: true, product: { select: { sku: true, name: true, weightGrams: true } } } },
            },
        }),
        loadDeliveryMethod("SHIPWAY"),
    ]);
    if (!order) throw new Error("Order not found");
    if (!method) throw new Error("Shipway is not configured under Settings → Couriers");
    const cfg = method.configJson as ShipwayConfig & { warehouseId?: string | number };

    // Address: prefer the delivery's snapshot, fall back to the order's.
    const addr = ((del.addressJson ?? order.shippingAddress) ?? {}) as ShipAddress;
    if (!addr.pincode || !addr.line1 || !addr.name || !addr.phone) {
        throw new Error("The order has no complete shipping address");
    }
    // The chosen carrier rides the checkout optionId ("shipway:3:19339").
    const carrierId = Number(String(addr.courierOptionId ?? "").split(":")[2]) || 0;
    if (!carrierId) {
        throw new Error("The order has no Shipway carrier snapshot — change the courier and pick a Shipway option");
    }

    // Same normalisations as the Shiprocket push: 10-digit phone, first/last name.
    const phone10 = String(addr.phone).replace(/\D/gu, "").slice(-10);
    if (phone10.length !== 10) {
        throw new Error(`The shipping phone "${addr.phone}" is not a valid 10-digit mobile number`);
    }
    const nameParts = String(addr.name).trim().split(/\s+/u);
    const firstName = nameParts.slice(0, -1).join(" ") || nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    const warehouseId = await resolveWarehouseId(cfg);

    const fallbackWeight = Number(cfg.defaultItemWeightGrams) || 500;
    let grams = 0;
    const products: ShipwayOrderItem[] = order.lines.map((l) => {
        grams += (l.product.weightGrams ?? fallbackWeight) * l.quantity;
        return {
            product: l.product.name,
            price: (l.unitPricePaise / 100).toFixed(2),
            product_code: l.product.sku,
            product_quantity: String(l.quantity),
        };
    });
    const goods = order.totalPaise / 100;
    const shipping = (order.shippingChargePaise ?? 0) / 100;

    const orderId = `WEB-${del.orderId}`;
    const common = {
        address: [addr.line1, addr.line2].filter(Boolean).join(", "),
        city: String(addr.city ?? ""),
        state: String(addr.state ?? ""),
        zip: String(addr.pincode),
    };
    const { awb, labelUrl } = await shipwayCreateOrderWithLabel({
        order_id: orderId,
        carrier_id: carrierId,
        warehouse_id: warehouseId,
        return_warehouse_id: warehouseId,
        products,
        discount: "0",
        shipping: shipping.toFixed(2),
        order_total: (goods + shipping).toFixed(2),
        taxes: "0",
        payment_type: order.paymentMethod === "COD" ? "C" : "P",
        billing_address: common.address,
        billing_city: common.city,
        billing_state: common.state,
        billing_country: "India",
        billing_firstname: firstName,
        billing_lastname: lastName,
        billing_phone: phone10,
        billing_zipcode: common.zip,
        shipping_address: common.address,
        shipping_city: common.city,
        shipping_state: common.state,
        shipping_country: "India",
        shipping_firstname: firstName,
        shipping_lastname: lastName,
        shipping_phone: phone10,
        shipping_zipcode: common.zip,
        order_weight: String(Math.max(50, Math.round(grams))),
        box_length: String(Number(cfg.length) || 15),
        box_breadth: String(Number(cfg.breadth) || 15),
        box_height: String(Number(cfg.height) || 10),
        order_date: businessTodayIso(),
    });

    // Pickup request + tracking URL are best-effort — never lose the AWB over them.
    await shipwayCreatePickup({
        carrierId,
        warehouseId,
        orderIds: [orderId],
        cod: order.paymentMethod === "COD",
    }).catch(() => undefined);
    const trackingUrl = await shipwayTrackByAwb(awb)
        .then((t) => t.trackUrl)
        .catch(() => null);

    // labelUrl is only issued in the push response (no re-fetch API) — persist it
    // on the address snapshot (JSON bridge, same pattern as the order's courier
    // snapshot) so "Print label" works later.
    const addrJson = ((del.addressJson ?? order.shippingAddress) ?? {}) as Record<string, unknown>;
    await prisma.ticketDelivery.update({
        where: { ticketId: deliveryTicketId },
        data: {
            carrier: "SHIPWAY",
            shipmentId: orderId, // Shipway keys shipments by the pushed order id
            awb,
            trackingUrl,
            ...(labelUrl ? { addressJson: { ...addrJson, labelUrl } } : {}),
        },
    });
    // Mirror the AWB onto the shop order (header + "Mark Dispatched" pre-fill).
    await prisma.ticketOrder
        .update({ where: { ticketId: del.orderId }, data: { trackingNumber: awb } })
        .catch(() => undefined);
    // Advance the delivery to "Carrier Assigned".
    await prisma.ticket.update({ where: { id: deliveryTicketId }, data: { status: DELIVERY_STAGE.CARRIER_ASSIGNED } });

    const courierName =
        (del.addressJson as { courierService?: string } | null)?.courierService ??
        (order.shippingAddress as { courierService?: string } | null)?.courierService ??
        null;
    return { awb, courierName, labelUrl, trackingUrl };
}
