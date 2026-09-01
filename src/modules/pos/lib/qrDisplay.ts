// Client for the customer-facing DQ11 display, over whichever transport this machine has.
//
// **In Electron** — commands go over IPC (preload `electronAPI.qr` → main →
// hardware-bridge/qr.js). The bundled bridge has no HTTP port: that shape was inherited
// from when the app ran in a plain browser and HTTP was the only way to reach a local
// process, and inside Electron it only left the display drivable by anything that could
// reach the port.
//
// **In a browser** — falls back to the standalone combined-bridge on :9192, exactly as
// the app worked before Electron absorbed it. Note this reaches the bridge on the
// BROWSER's own PC, never the counter's: an admin opening the app from their desk drives
// their own hardware, which is the design the combined bridge always had (every PC its
// own bridge, its own printer, its own display). If that PC has no combined-bridge
// install there is nothing to reach, and every call is a silent no-op.
//
// Chosen per call from `window.electronAPI`, so there is no flag to set and nothing to
// rebuild — a browser simply never has it. Command names deliberately mirror the old
// HTTP paths so one small `switch` covers the fallback.
//
// **Every `qrDisplay.*` call must be best-effort** — if the bridge is down, POS must keep
// working. Never surface a failure to the cashier; never throw into the React render path.

import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";

const RELAY = "http://localhost:9192";

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

/** Command → the HTTP shape a standalone combined-bridge expects. */
function httpShape(cmd: string): { method: "GET" | "POST"; path: string } {
    switch (cmd) {
        case "health":     return { method: "GET",  path: "/health" };
        case "config:get": return { method: "GET",  path: "/config" };
        case "config:set": return { method: "POST", path: "/config" };
        case "ports":      return { method: "GET",  path: "/ports"  };
        // The rest — pos/cart, idle/start, clear … — are POSTs whose path is the command.
        default:           return { method: "POST", path: `/${cmd}` };
    }
}

async function httpCall(cmd: string, payload: unknown, timeoutMs: number): Promise<Response> {
    const { method, path } = httpShape(cmd);
    return fetch(`${RELAY}${path}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body:    method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
        signal:  AbortSignal.timeout(timeoutMs),
        credentials: "omit",
        cache:       "no-store",
    });
}

/**
 * Command that needs an answer — the settings page (config, COM ports, test screens).
 * Unlike `qrDisplay.*` this **throws**, because the settings page has a human waiting on
 * a toast and a silent failure there is just confusing.
 */
export async function qrRequest<T>(cmd: string, payload?: unknown): Promise<T> {
    const qr = bridge();
    if (qr) {
        const reply = await qr.request(cmd, payload);
        if (!reply?.ok) throw new Error(reply?.error || `"${cmd}" failed.`);
        return reply.result as T;
    }

    const r = await httpCall(cmd, payload, 5000);
    if (!r.ok) {
        // The bridge answers errors as { error }, but a 502 from something else on the
        // port may not be JSON at all — never let the parse failure mask the real status.
        const detail = await r.json().catch(() => null);
        throw new Error(detail?.error || `"${cmd}" failed (HTTP ${r.status}).`);
    }
    return (await r.json()) as T;
}

function send(cmd: string, payload: unknown): void {
    try {
        const qr = bridge();
        if (qr) return qr.send(cmd, payload);
        void httpCall(cmd, payload, 2000).catch(() => {});
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
