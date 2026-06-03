// Fire-and-forget client for the local QR-display relay (DQ11).
//
// The relay runs on the shop PC at http://localhost:9192 and drives the
// customer-facing USB display. **Every call must be best-effort** — if the
// relay is down, slow, or returns an error, POS must keep working. Never
// surface a failure to the cashier; never throw into the React render path.

const RELAY = "http://localhost:9192";

async function send(path: string, body: unknown): Promise<void> {
    try {
        await fetch(`${RELAY}${path}`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(2000),
            credentials: "omit",
            cache:       "no-store",
        });
    } catch {
        // Relay unreachable — silent.
    }
}

// Spend-tier name shown on the customer display. Admin-defined (see CustomerTier),
// so any string — not a fixed Bronze/Silver/Gold/Platinum union.
export type CustomerLevel = string;

export interface QrCustomer {
    name:           string;
    level?:         CustomerLevel;
    loyaltyPoints?: number;
    lastVisitAt?:   string | null;
    discountPct?:   number;
    balanceDue?:    number;
}

export interface QrCartItem {
    name:  string;
    qty:   number;
    price: number;
    /// Per-unit MRP (rupees, tax-inclusive tag) — struck-through on the display.
    mrp?:     number;
    /// Per-unit barcode / printed tag price (rupees, tax-inclusive).
    barcode?: number;
}

/// One named row of the customer-facing "Today's discount" pool.
export interface QrDiscountRow { label: string; amount: number }

export interface QrCart {
    items:     QrCartItem[];
    subtotal:  number;
    discount?: number;
    total:     number;
    title?:    string;
    /// "Today's discount" rows (counter discount + tier + loyalty + coupon). Additive
    /// — the relay must be updated to render these; old relays ignore them.
    discounts?: QrDiscountRow[];
    /// Signed bill adjustments (shipping/round-off/manual). + adds, − reduces.
    charges?:   QrDiscountRow[];
    /// Combined GST embedded in the bill (CGST+SGST) — informational line.
    gst?:       number;
    /// "You saved ₹X (Y%)" hero — MRP total minus paid.
    savings?:   { amount: number; pct: number };
}

export interface QrPayment {
    total:    number;
    cashPaid: number;
    balance:  number;
}

export interface QrUpi {
    amount:     number;
    vpa?:       string;
    payeeName?: string;
    caption?:   string;
}

export interface QrThankyou {
    amount?: number;
    message?: string;
}

export const qrDisplay = {
    customer: (data: QrCustomer) => send("/pos/customer", data),
    cart:     (data: QrCart)     => send("/pos/cart",     data),
    payment:  (data: QrPayment)  => send("/pos/payment",  data),
    upi:      (data: QrUpi)      => send("/pos/upi",      data),
    thankyou: (data: QrThankyou) => send("/pos/thankyou", data),
    idle:     ()                 => send("/idle/start",   {}),
    clear:    ()                 => send("/clear",        {}),
};
