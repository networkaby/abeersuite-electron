// ── priceLadder ──────────────────────────────────────────────────────────────
// Pure, display-only computation of the customer-facing "Today's discount"
// price ladder:  MRP → barcode (tag) → effective sale price → tier → loyalty →
// coupon → paid, plus a "You saved ₹X (Y%)" hero and a net-of-discount HSN /
// rate-wise tax summary.
//
// Design notes:
//  • This NEVER changes the stored voucher. It derives the ladder from data the
//    real voucher already holds (per-line mrp/barcode/effective + the tier /
//    loyalty / coupon reductions). Editing or returning a voucher simply
//    re-computes the ladder — there is no second "obfuscated" record.
//  • All money is rupees (callers convert paise → rupees for the line amounts
//    they already hold; mrp/barcode arrive as paise and are converted here).
//  • The per-item *effective* price stays internal — the receipt/display show
//    MRP + barcode per line and POOL every reduction into "Today's discount",
//    so the real per-item price isn't recoverable from a multi-item bill.
//  • GST: the invoice-level discount is distributed proportionally across lines
//    (by line value) so each line's NET taxable + NET tax is computed at its own
//    rate. The HSN/rate summary therefore reconciles: Σ taxable + Σ tax = paid.

import { round2 as r2 } from "@/shared/lib/format/moneyInr";

export type LadderLineInput = {
    description: string;
    qty:         number;
    /// Tax-inclusive MRP (tag), paise. null/absent → no MRP shown for this line.
    mrpPaise?:   number | null;
    /// Tax-inclusive barcode / printed tag price, paise. null → falls back to the
    /// charged amount (no "price benefit" for this line).
    barcodePaise?: number | null;
    /// GST rate % applied to this line.
    taxRatePct:  number;
    /// Actual GST charged on this line (rupees) — on the line's effective price.
    taxAmount:   number;
    /// Tax-inclusive charged line amount (rupees), before bill-level discounts.
    amount:      number;
    /// HSN code for the rate/HSN summary. Absent → grouped by rate only.
    hsnCode?:    string | null;
};

export type LadderInput = {
    lines:           LadderLineInput[];
    tierDiscount?:   number;   // rupees (spend-tier / Gold etc.)
    loyaltyDiscount?: number;  // rupees (points redeemed → ₹)
    couponDiscount?: number;   // rupees
    /// Bill-level adjustments AFTER the goods discounts — shipping, round-off,
    /// manual charges. Amount is SIGNED: + adds to the bill (shipping/fee),
    /// − reduces it (manual discount). Excludes loyalty/coupon (those are the
    /// dedicated discount fields above). Shown as their own rows, tax-INCLUSIVE
    /// (same convention as a goods line) — the goods HSN/rate TABLE is computed
    /// on the goods total only, NOT including these.
    /// `taxAmount` — GST embedded in this charge (e.g. shipping inherits the
    /// bill's rate — see resolveShippingGstRate). Pools into `taxTotal` /
    /// `cgstTotal` / `sgstTotal` below, same as product tax, so the bill's
    /// total GST figure matches what's posted to GL. Absent/0 = untaxed charge.
    extraCharges?:   { label: string; amount: number; taxAmount?: number }[];
    /// Final amount the customer pays (rupees) — the voucher total.
    total:           number;
};

export type LadderLine = {
    description: string;
    qty:         number;
    /// Tax-inclusive MRP total for the line (rupees), or null.
    mrp:         number | null;
    /// Tax-inclusive barcode total for the line (rupees), or null.
    barcode:     number | null;
    /// Charged tax-inclusive line amount (rupees).
    amount:      number;
};

export type LadderDiscountKey = "shopBelowMrp" | "priceBenefit" | "tier" | "loyalty" | "coupon";
export type LadderDiscountRow = { key: LadderDiscountKey; label: string; amount: number };
/// Signed bill-level adjustment row (shipping/round-off/manual charge).
/// amount > 0 = added to the bill, amount < 0 = reduces it.
export type LadderChargeRow = { label: string; amount: number };

export type HsnRow = {
    hsn:     string;   // HSN code or "—"
    ratePct: number;
    taxable: number;   // net pre-tax value (rupees)
    cgst:    number;
    sgst:    number;
    total:   number;   // taxable + cgst + sgst
};

export type PriceLadder = {
    lines:        LadderLine[];
    mrpTotal:     number;   // tax-inclusive
    barcodeTotal: number;
    effectiveTotal: number; // tax-inclusive charged base, before bill discounts
    /// Bill-arithmetic reductions for the "Today's discount" block (Gross-at-
    /// barcode → paid): priceBenefit + tier + loyalty + coupon. Non-zero only.
    discounts:    LadderDiscountRow[];
    todaysDiscountTotal: number;
    /// Signed bill-level adjustments (shipping/round-off/manual). Non-zero only.
    /// goodsPaid − Σ(reductions) + Σ(additions) reconciles to `paid`.
    charges:      LadderChargeRow[];
    chargesTotal: number;   // signed sum
    /// MRP → barcode markdown (rupees). Shown via the struck per-line MRP / the
    /// savings hero — NOT part of `discounts`. Exposed for optional display.
    shopBelowMrp: number;
    paid:         number;
    savingsTotal: number;   // mrpTotal − paid (≥ 0)
    savingsPct:   number;   // rounded %
    /// Net-of-discount HSN/rate-wise tax summary (Σ taxable + Σ tax = paid).
    hsn:          HsnRow[];
    taxableTotal: number;
    cgstTotal:    number;
    sgstTotal:    number;
    taxTotal:     number;
};

const EPS = 0.005;

const LABELS: Record<LadderDiscountKey, string> = {
    shopBelowMrp: "Shop price below MRP",
    priceBenefit: "Counter discount",
    tier:         "Level discount",
    loyalty:      "Loyalty",
    coupon:       "Coupon",
};

/**
 * Compute the customer-facing price ladder. Pure — safe to call on the server
 * (receipt route) or the client (POS QR / thermal push).
 *
 * `labels` lets callers override the discount-row wording (e.g. "Gold tier (5%)",
 * "Loyalty (100 pts)", "Coupon SAVE10").
 */
export function computePriceLadder(
    input: LadderInput,
    labels?: Partial<Record<LadderDiscountKey, string>>,
): PriceLadder {
    let mrpTotal = 0, barcodeTotal = 0, effectiveTotal = 0;
    let shopBelowMrp = 0, priceBenefit = 0;

    const lines: LadderLine[] = input.lines.map((l) => {
        const eff = l.amount;                                  // charged inclusive
        const bcRaw = l.barcodePaise != null ? (l.barcodePaise / 100) * l.qty : null;
        const mrRaw = l.mrpPaise != null ? (l.mrpPaise / 100) * l.qty : null;
        // PUBLIC TAG = barcode if present, else MRP, else (no public number) the
        // charged price. Falling back to MRP — not to the charged price — keeps the
        // real per-item price hidden whenever ANY public number exists; only when
        // BOTH barcode and MRP are missing is the real price unavoidably shown.
        const hasTag = bcRaw != null || mrRaw != null;
        const tagRaw = bcRaw != null ? bcRaw : (mrRaw != null ? mrRaw : eff);
        // Clamp so the ladder never goes backwards: eff ≤ tag ≤ mrp.
        const bc = Math.max(tagRaw, eff);                      // shown public tag total
        const mr = mrRaw != null ? Math.max(mrRaw, bc) : bc;   // MRP ≥ tag
        shopBelowMrp   += mr - bc;
        priceBenefit   += bc - eff;
        mrpTotal       += mr;
        barcodeTotal   += bc;
        effectiveTotal += eff;
        return {
            description: l.description,
            qty:         l.qty,
            // Struck MRP only when it sits ABOVE the shown tag (i.e. a barcode tag
            // exists below MRP). When MRP itself is the tag, don't strike it.
            mrp:         (mrRaw != null && mr > bc + EPS) ? r2(mr) : null,
            barcode:     hasTag ? r2(bc) : null,
            amount:      r2(eff),
        };
    });

    const tier    = Math.max(0, input.tierDiscount ?? 0);
    const loyalty = Math.max(0, input.loyaltyDiscount ?? 0);
    const coupon  = Math.max(0, input.couponDiscount ?? 0);
    const paid    = input.total;

    const lbl = (k: LadderDiscountKey) => labels?.[k] ?? LABELS[k];
    // "Today's discount" is the BILL arithmetic: Gross-at-barcode → paid, i.e.
    // priceBenefit (barcode→effective) + tier + loyalty + coupon. shopBelowMrp
    // (MRP→barcode) is NOT here — it's shown via the struck per-line MRP and the
    // savings hero — so `barcodeTotal − todaysDiscountTotal` reconciles to paid.
    const discounts: LadderDiscountRow[] = (
        [
            { key: "priceBenefit", amount: priceBenefit },
            { key: "tier",         amount: tier },
            { key: "loyalty",      amount: loyalty },
            { key: "coupon",       amount: coupon },
        ] as { key: LadderDiscountKey; amount: number }[]
    )
        .filter((d) => d.amount > EPS)
        .map((d) => ({ key: d.key, label: lbl(d.key), amount: r2(d.amount) }));

    // Bill-level adjustments (shipping/round-off/manual). Shown as their own
    // signed rows AFTER the goods discounts; they don't touch the goods HSN/tax.
    const charges: LadderChargeRow[] = (input.extraCharges ?? [])
        .filter((c) => Math.abs(c.amount) > EPS)
        .map((c) => ({ label: c.label, amount: r2(c.amount) }));
    const chargesTotal = r2(charges.reduce((s, c) => s + c.amount, 0));

    // Goods total the customer actually pays for the items (tax-incl), i.e. after
    // the goods discounts but BEFORE bill charges. The HSN/tax summary reconciles
    // to THIS, and `goodsPaid + chargesTotal` reconciles to `paid`.
    const goodsPaid = r2(effectiveTotal - tier - loyalty - coupon);

    const savingsTotal = Math.max(0, r2(mrpTotal - paid));
    const savingsPct   = mrpTotal > EPS ? Math.round((savingsTotal / mrpTotal) * 100) : 0;

    // ── HSN / rate-wise tax summary, net of the goods discounts ───────────────
    // Distribute the goods discount proportionally by line value so each line's
    // net taxable + net tax is at its own rate and the summary reconciles to
    // `goodsPaid` (bill charges sit outside the goods tax). factor = goodsPaid /
    // effectiveTotal.
    const factor = effectiveTotal > EPS ? goodsPaid / effectiveTotal : 1;
    const groups = new Map<string, HsnRow>();
    for (const l of input.lines) {
        const rate = l.taxRatePct;
        const hsn  = (l.hsnCode ?? "").trim() || "—";
        const key  = `${hsn}|${rate}`;
        const net  = l.amount * factor;                        // discounted inclusive
        const taxable = rate > 0 ? net / (1 + rate / 100) : net;
        const tax  = net - taxable;
        const row  = groups.get(key) ?? { hsn, ratePct: rate, taxable: 0, cgst: 0, sgst: 0, total: 0 };
        row.taxable += taxable;
        row.cgst    += tax / 2;
        row.sgst    += tax / 2;
        row.total   += net;
        groups.set(key, row);
    }
    const hsn = [...groups.values()]
        .map((g) => ({ hsn: g.hsn, ratePct: g.ratePct, taxable: r2(g.taxable), cgst: r2(g.cgst), sgst: r2(g.sgst), total: r2(g.total) }))
        .sort((a, b) => a.ratePct - b.ratePct || a.hsn.localeCompare(b.hsn));

    const taxableTotal = r2(hsn.reduce((s, g) => s + g.taxable, 0));
    // GST embedded in tax-bearing charge rows (shipping) — same pool as goods
    // tax, split CGST/SGST 50/50 like the HSN rows above (the INTRA/INTER
    // label is a display-side decision made from the combined total, same as
    // for goods — see ThermalReceiptPreview / computeGstSplit).
    const chargesTax  = (input.extraCharges ?? []).reduce((s, c) => s + Math.max(0, c.taxAmount ?? 0), 0);
    const cgstTotal    = r2(hsn.reduce((s, g) => s + g.cgst, 0) + chargesTax / 2);
    const sgstTotal    = r2(hsn.reduce((s, g) => s + g.sgst, 0) + chargesTax / 2);
    const taxTotal     = r2(cgstTotal + sgstTotal);

    return {
        lines,
        mrpTotal: r2(mrpTotal),
        barcodeTotal: r2(barcodeTotal),
        effectiveTotal: r2(effectiveTotal),
        discounts,
        todaysDiscountTotal: r2(discounts.reduce((s, d) => s + d.amount, 0)),
        charges,
        chargesTotal,
        shopBelowMrp: r2(shopBelowMrp),
        paid: r2(paid),
        savingsTotal,
        savingsPct,
        hsn,
        taxableTotal,
        cgstTotal,
        sgstTotal,
        taxTotal,
    };
}
