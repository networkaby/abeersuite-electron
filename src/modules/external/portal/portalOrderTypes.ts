/** One customer order as the portal and the customer app show it — built by
 *  loadPortalOrders() (portalOrders.ts, server only); safe for browser code. */
export type PortalOrderDto = {
    id: number;
    createdAt: string; // ISO
    accountLabel: string;
    // Pipeline stage
    statusId: string | null;
    statusLabel: string | null;
    statusColor: string | null;
    // Payment
    isPaid: boolean;
    isCod: boolean;
    paidAt: string | null;
    gatewayLabel: string | null;
    // Money
    goodsPaise: number;
    shippingPaise: number;
    tierDiscountPaise: number;
    tierLabel: string | null;
    couponDiscountPaise: number;
    couponCode: string | null;
    loyaltyRedeemPaise: number;
    loyaltyRedeemPoints: number;
    // Lines
    lines: { name: string; quantity: number; amountPaise: number }[];
    // Ship to
    address: string | null;
    shipName: string | null;
    // Courier / delivery
    courierLabel: string | null;
    deliveryStageLabel: string | null;
    awb: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    // Linked invoice (posted ONLINE_INVOICE)
    invoice: { detailId: number; voucherNo: string; placeOfSupply: string | null } | null;
    // Online payment still to finish (the app's order screen offers Pay now)
    onlineProvider: string | null;
    awaitingPayment: boolean;
};

// Forward journey; index = how far the order has come (S42 New … S47 Delivered).
export const JOURNEY: { stage: string; label: string }[] = [
    { stage: "S42", label: "Order placed" },
    { stage: "S44", label: "Confirmed" },
    { stage: "S45", label: "Packing" },
    { stage: "S46", label: "Dispatched" },
    { stage: "S47", label: "Delivered" },
];
export const STAGE_ORDER = ["S42", "S43", "S44", "S45", "S46", "S47"];
