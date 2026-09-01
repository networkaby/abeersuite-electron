// Fire-and-forget client for the customer-facing DQ11 display.
//
// Commands go over Electron IPC (preload `electronAPI.qr` → main → hardware-bridge/qr.js).
// This used to POST to a local HTTP relay on :9192, a shape inherited from when the app
// ran in a plain browser; inside Electron that port bought nothing and left the display
// drivable by anything on the shop LAN.
//
// **Every call must be best-effort** — if the bridge is down, POS must keep working.
// Never surface a failure to the cashier; never throw into the React render path.
// Outside Electron (the app opened from another PC's browser) there is no bridge to
// reach, so every call is a silent no-op — same outcome as the old fetch to a localhost
// that was never this counter.

import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";

type QrReply = { ok: boolean; result?: unknown; error?: string };

type QrBridge = {
    qr?: {
        send:    (cmd: string, payload?: unknown) => void;
        request: (cmd: string, payload?: unknown) => Promise<QrReply>;
    };
};

function bridge(): QrBridge["qr"] | undefined {
    if (!isElectronEnvironment()) return undefined;
    return (window as unknown as { electronAPI?: QrBridge }).electronAPI?.qr;
}

/**
 * Command that needs an answer — the settings page (config, COM ports, test screens).
 * Unlike `qrDisplay.*` this **throws**, because the settings page has a human waiting
 * on a toast and a silent failure there is just confusing.
 */
export async function qrRequest<T>(cmd: string, payload?: unknown): Promise<T> {
    const qr = bridge();
    if (!qr) throw new Error("Display bridge is only available in the desktop app.");
    const reply = await qr.request(cmd, payload);
    if (!reply?.ok) throw new Error(reply?.error || `"${cmd}" failed.`);
    return reply.result as T;
}

function send(cmd: string, payload: unknown): void {
    try {
        bridge()?.send(cmd, payload);
    } catch {
        // Bridge unreachable — silent, by contract.
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

/// A single item NOT yet on the bill — Product Explorer hover preview, so the
/// customer can see the actual photo/name/price and agree before it's added.
/// Distinct screen from QrCart (the running bill), which stays text-only.
export interface QrProduct {
    name:   string;
    price:  number;
    /// MRP (rupees, tax-inclusive tag) — struck-through when higher than price.
    mrp?:   number;
    /// Shelf photo URL. Missing/unreachable/unsupported falls back to a
    /// text-only card on the relay side — never breaks the frame.
    image?: string;
}

export const qrDisplay = {
    customer: (data: QrCustomer) => send("pos/customer", data),
    cart:     (data: QrCart)     => send("pos/cart",     data),
    payment:  (data: QrPayment)  => send("pos/payment",  data),
    upi:      (data: QrUpi)      => send("pos/upi",      data),
    product:  (data: QrProduct)  => send("pos/product",  data),
    thankyou: (data: QrThankyou) => send("pos/thankyou", data),
    idle:     ()                 => send("idle/start",   {}),
    clear:    ()                 => send("clear",        {}),
};
