// What POST /api/pos/sale accepts, and the "already saved" answer for a
// retried Save. Moved out of the route (which had grown past 1,500 lines);
// the code is unchanged.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { isoDateSchema } from "@/shared/lib/schemas";
import { POS_MAX_ROUND_OFF } from "@/shared/lib/constants/inventory";

export const lineSchema = z.object({
    productId: z.number().int().positive(),
    description: z.string().trim().min(1),
    /** The cashier's line note (serial no., colour) — its own column. */
    note: z.string().trim().max(500).nullish(),
    quantity: z.number().positive(),
    // Pre-tax rate BEFORE any customer-group rebate — the server works the
    // rebate out itself and posts the line at the lower rate.
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).max(100).default(0),
    // Snapshots for the customer-facing "Today's discount" price ladder (paise).
    mrpPaise: z.number().int().nonnegative().nullish(),
    savedSalePricePaise: z.number().int().nonnegative().nullish(),
    // The counter billed this line from barcode with its sale price as the
    // floor — every discount stops there (priceFloor.ts). The floor itself is
    // read from the DB. Absent = no wall (edited / converted line, old counter).
    applyFloor: z.boolean().optional(),
});

export const paymentSchema = z.object({
    // Which counter payment account collected this — null = CASH (the till).
    // The server resolves its ledger + method from the counter's list.
    paymentAccountId: z.number().int().positive().nullable(),
    amount: z.number().positive(),
    reference: z.string().trim().max(120).optional(),
});

// Signed amount — positive raises the bill (Cr Income leg), negative lowers it
// (Dr Expense leg). Mirrors office SALE charges. accountId is the GL account
// the leg posts against.
export const chargeSchema = z.object({
    accountId: z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    amount: z.number().refine((n) => Math.abs(n) >= 0.005, "Charge amount must be non-zero"),
});

// Service line (Settings → Services catalogue). The client sends only
// the id + qty + tax-EXCLUSIVE unit price; the server re-resolves the income
// ledger + GST rate from the catalogue — never trusted from the browser. Posts
// GL-only (Cr income net + Cr Output GST as a tax-bearing charge); no stock.
export const serviceLineSchema = z.object({
    serviceId: z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
});

export const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: isoDateSchema,
    dueDate: isoDateSchema,
    notes: z.string().trim().optional(),
    // Goods lines. A sale may also be services-only — the cross-field refine
    // below enforces "at least one line OR one service".
    lines: z.array(lineSchema).default([]),
    services: z.array(serviceLineSchema).default([]),
    // May be empty: a fully-on-credit bill collects nothing at the counter.
    // What the customer may take on credit is decided by checkCreditLimit,
    // not by the shape of this array.
    payments: z.array(paymentSchema).default([]),
    shippingAmt: z.number().min(0).default(0),
    // Signed; a typed R-off may not skip the lowest-price wall (constants/inventory.ts).
    // +1 paisa slack for float noise. Auto round-off is always within ±0.50.
    roundOff: z.number().min(-POS_MAX_ROUND_OFF - 0.01).max(POS_MAX_ROUND_OFF + 0.01).default(0),
    charges: z.array(chargeSchema).default([]),
    // Voucher-level tier discount (₹). Reduces the bill via the existing
    // discountAmt → "Discount Allowed" path. Client-supplied (cashier-trusted,
    // same as line prices). Server still validates payment total == bill total.
    discountAmt: z.number().min(0).default(0),
    // Spend-tier % that produced discountAmt (e.g. 5 for Gold). Stored so the
    // receipt can label the "Level Discount (Gold)" row by resolving the tier
    // name from this %. 0 when no tier applied.
    discountPct: z.number().min(0).max(100).default(0),
    // Loyalty points the customer wants to burn. The server is authoritative for
    // the ₹ value (recomputed from LoyaltyConfig) and validates against balance.
    redeemPoints: z.number().int().min(0).default(0),
    // Coupon code the cashier entered (server resolves the ₹ value + validity).
    couponCode: z.string().trim().max(40).optional(),
    // Force-apply a SPECIFIC coupon by id — AUTO offers have no code, so the
    // POS "Apply" button on an AUTO offer card carries its id instead.
    couponId: z.number().int().optional(),
    // When true (and no code), the server auto-applies the best eligible offer.
    autoApply: z.boolean().default(false),
    // Independent FREE-GRANT coupon (FREE_ITEM / BOGO) — applies ON TOP of the
    // money coupon: its item(s) are added as zero-price lines (quantity 0 +
    // freeQty, so stock + COGS move but no money) and it never drops tier,
    // blocks loyalty, or counts against the global guard.
    freeCouponCode: z.string().trim().max(40).optional(),
    // Force-apply a specific free-grant coupon by id (AUTO — no code).
    freeCouponId: z.number().int().optional(),
    // When true (no code), the server auto-selects the best eligible AUTO
    // free-grant coupon from the cart — a no-code AUTO FREE_ITEM / BOGO offer
    // fires on its own. Server-authoritative: re-derived here, never trusted
    // from the browser.
    freeAutoApply: z.boolean().default(false),
    // Gift-card code to redeem as a payment tender (server owns the ₹ drawn).
    giftCardCode: z.string().trim().max(40).optional(),
    // Collect-on-the-go: when true, the cashier is knowingly accepting MORE than
    // the bill. The surplus settles the customer's oldest open bills (FIFO) and
    // any leftover becomes a customer advance — booked as a separate Receipt
    // voucher so the bank/UPI statement matches 1:1. Requires an identified
    // customer; rejected alongside a gift-card redemption.
    collectSurplus: z.boolean().default(false),
    // Convert-to-sale: the source estimate/order this POS sale was rung up from.
    // Stored as refVoucherId so the source flips to "Converted".
    sourceVoucherId: z.number().int().positive().optional(),
    // Bank charge (MDR, whole ₹) the POS worked out from these payments with the
    // method rules it loaded (paymentMdr.ts). Absent = a client that does not do
    // MDR, so none is applied; present but different from the server's own figure
    // = the rules changed under the counter → refused, so the bill is never
    // silently short.
    mdrRecovery: z.number().min(0).optional(),
    // Repair ticket this bill was raised from (Generate Bill on the ticket). The
    // voucher is linked to it (VoucherLink kind=TICKET) so it shows in the
    // ticket's Invoices panel, and a timeline entry is written on the ticket.
    ticketId: z.number().int().positive().optional().nullable(),
    // Bill key — one random id per bill, the SAME on every Save of that bill
    // (PosScreen makes it). A key already on a voucher means an earlier try
    // committed and its reply was lost: answered "already saved", never billed
    // again. Optional so a counter older than the key still bills.
    requestKey: z.string().trim().min(8).max(100).optional(),
}).refine((d) => d.lines.length + d.services.length >= 1, {
    message: "At least one line item or service required",
    path: ["lines"],
});

/**
 * The answer for a Save whose bill key is already on a voucher, or null when it
 * is not (or there is no key). 200, not 409: it IS the success the cashier was
 * waiting for, so the screen takes its success path, and a counter relay treats
 * it like any saved bill — it pulls the office's rows into the replica. The
 * reply carries only what identifies the bill; the screen offers a reprint.
 */
export async function alreadySavedReply(requestKey: string | undefined): Promise<NextResponse | null> {
    if (!requestKey) return null;
    // Where it saves: under W:Live the replica does not have a bill saved a moment ago.
    const uv = await prismaWhereSaved().universalVoucher.findUnique({
        where: { requestKey },
        select: { id: true, type: true, voucherNo: true, voucherDetail: { select: { id: true } } },
    });
    if (!uv) return null;
    if (uv.type !== "POS" || !uv.voucherDetail) {
        return NextResponse.json(
            { error: "This bill key belongs to another voucher. Start a new bill and save again.", code: "REQUEST_KEY_REUSED" },
            { status: 409 },
        );
    }
    return NextResponse.json({
        alreadySaved: true,
        voucherId: uv.voucherDetail.id,
        voucherRef: uv.voucherNo,
        universalVoucherId: uv.id,
    });
}
