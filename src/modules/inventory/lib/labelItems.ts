/**
 * Barcode-label items — the shape printed by LabelDesigner, plus the rules that
 * decide how many copies of each label to print.
 *
 * Both label surfaces build the same Item: Pricing Strategy → Update & print
 * labels (from its priced rows) and Pricing Strategy → Print labels (from the
 * engine items straight). Keeping the shape + the copies rule here means the two
 * pages can never drift on what a label says or how many come out.
 */

import { barcodePrice, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import type { PricingItem } from "@/app/api/pricing-strategy/items/route";

/** One label, as rendered by the designer (all display strings, in ₹). */
export type Item = {
    id: number;
    name: string;
    barcode: string;
    price: string;
    mrp: string;
    date: string;
    /** How many copies of this label to print (≥ 1). */
    copies: number;
};

/** A product the designer asks the parent to add to the shared set (₹ values). */
export type AddedProduct = {
    /** Real InvProduct id when the source knew it (combobox / voucher line). */
    id?: number;
    name: string;
    barcode: string;
    salePrice: number | null;
    costPrice: number | null;
    mrp: number | null;
    /** Units arriving on the GRN/Purchase line that added it (drives copies). */
    incomingQty?: number;
    /** On-hand stock at the time it was added (drives copies). */
    stock?: number | null;
};

/**
 * Default number of labels for one product.
 *
 * A re-priced item needs a new label on EVERY piece sitting on the shelf, so the
 * default is the full available stock. When the price and barcode are unchanged,
 * the old pieces already carry a correct label — only the units just received
 * need one, so the default is the incoming voucher qty (1 when nothing came in,
 * e.g. a plain search/scan).
 */
export function defaultCopies(opts: {
    priceChanged: boolean;
    stock?: number | null;
    incomingQty?: number | null;
}): number {
    const pick = opts.priceChanged ? opts.stock : opts.incomingQty;
    const n = Math.ceil(Number(pick) || 0);
    return n > 0 ? n : 1;
}

/** Clamp a hand-typed copies value to a sane printable count. */
export const clampCopies = (n: number): number =>
    !isFinite(n) || n < 1 ? 1 : Math.min(999, Math.floor(n));

/** ISO "YYYY-MM-DD" for today, in the browser's own date. */
export function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Engine item → label. The printed price is the barcode price (the band-buffered,
 * MRP-capped tag), falling back to the saved sale price, then to the price that
 * currently sells — so a product nobody has frozen yet still prints a real price.
 */
export function pricingItemToLabelItem(it: PricingItem, bands: BarcodeBand[], copies: number): Item {
    const saved = it.savedSalePricePaise != null ? it.savedSalePricePaise / 100 : null;
    const mrp = it.mrpPaise != null ? it.mrpPaise / 100 : null;
    const tag = saved != null ? barcodePrice(saved, mrp != null && mrp > 0 ? mrp : null, bands).value : null;
    const effective = it.effectiveSalePricePaise != null ? it.effectiveSalePricePaise / 100 : null;
    const price = tag ?? saved ?? effective;
    return {
        id: it.id,
        name: it.name,
        barcode: it.barcode?.trim() || it.sku?.trim() || String(it.id),
        price: price != null ? String(Math.round(price)) : "0",
        mrp: mrp != null ? mrp.toFixed(2) : "0",
        date: it.salePriceFrozenAt ? it.salePriceFrozenAt.slice(0, 10) : "",
        copies,
    };
}
