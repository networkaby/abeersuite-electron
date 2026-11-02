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
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";

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
    /** Current on-hand stock, shown for the batch/copies decision. */
    stock?: number | null;
    // Catalogue rows only — feed the editable Barcode ₹ cell (gap + profit).
    /** Price the product sells at now (effectiveSalePricePaise, ₹). */
    sell?: number | null;
    /** Landed cost incl GST (₹). null = no cost known. */
    costIncl?: number | null;
    gstPct?: number;
    /** True when the barcode ₹ is hand-set (barcodeManualPaise). */
    manual?: boolean;
    /** The auto barcode ₹ (from saved Sale Price + MRP) — typing it back clears manual. */
    autoPrice?: number | null;
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
 * "YYYY-MM-DD" of an ISO timestamp in the browser's own date — NOT `iso.slice(0, 10)`,
 * which is the UTC date and rolls back a day for saves between 00:00 and 05:30 IST.
 */
export function localDateOf(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The label's product-name font. A CONDENSED family, because the name is the one
 * field that never fits: 41mm of a 50mm label holds ~32 characters of ordinary
 * sans, but ~40 of this, at the same point size. Condensing beats reducing the
 * font size — a smaller size loses cap height AND stroke weight together, which
 * is what actually breaks up on a 203dpi thermal head, while condensing costs
 * only width, the dimension in short supply. Arial Narrow ships with Windows;
 * the rest are fallbacks for other machines.
 */
export const LABEL_NAME_FONT =
    '"Arial Narrow", "Roboto Condensed", "Archivo Narrow", ui-sans-serif, system-ui, sans-serif';

/** Never condense past this — below it the strokes start to merge in print. */
export const LABEL_NAME_MIN_SCALE = 0.8;

/**
 * How far a name must be squeezed horizontally to fit `availableMm`, as a scaleX
 * factor. 1 = fits already (leave it alone — short names must not look squashed).
 * Floors at LABEL_NAME_MIN_SCALE, past which the name still gets an ellipsis.
 *
 * Measured on a canvas rather than in the DOM so a 300-copy run costs one
 * measurement per PRODUCT, not per printed label, and never triggers layout.
 */
export function nameFitScale(name: string, availableMm: number, fontSizePt: number): number {
    if (!name || typeof document === "undefined") return 1;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 1;
    ctx.font = `600 ${(fontSizePt * 96) / 72}px ${LABEL_NAME_FONT}`;
    const needPx = ctx.measureText(name).width;
    const availPx = (availableMm * 96) / 25.4;
    if (needPx <= availPx) return 1;
    return Math.max(LABEL_NAME_MIN_SCALE, availPx / needPx);
}

/**
 * Engine item → label. The printed price is the SAVED barcode price
 * (barcodeManualPaise); a product never saved yet falls back to the band tag on
 * its saved Sale Price (what it printed before saving existed), then the saved
 * Sale Price, then the price that sells now — so it still prints a real price.
 * `autoPrice` = what "auto" / Update barcode would save now: bands on the
 * EFFECTIVE price (barcodeStore.ts).
 */
export function pricingItemToLabelItem(it: PricingItem, bands: BarcodeBand[], copies: number): Item {
    const saved = it.savedSalePricePaise != null ? it.savedSalePricePaise / 100 : null;
    const mrp = it.mrpPaise != null ? it.mrpPaise / 100 : null;
    const mrpCap = mrp != null && mrp > 0 ? mrp : null;
    const effective = it.effectiveSalePricePaise != null ? it.effectiveSalePricePaise / 100 : null;
    const legacyTag = saved != null ? barcodePrice(saved, mrpCap, bands).value : null;
    const autoTag = effective != null ? barcodePrice(effective, mrpCap, bands).value : null;
    const tag = it.barcodeManualPaise != null ? it.barcodeManualPaise / 100 : legacyTag;
    const gstMul = 1 + (it.gstRatePct > 0 ? it.gstRatePct / 100 : 0);
    const price = tag ?? saved ?? effective;
    return {
        id: it.id,
        name: it.name,
        barcode: it.sku?.trim() || it.barcode?.trim() || String(it.id),
        price: price != null ? String(Math.round(price)) : "0",
        mrp: mrp != null ? mrp.toFixed(2) : "0",
        date: localDateOf(it.salePriceFrozenAt),
        copies,
        stock: it.stock,
        sell: effective,
        costIncl: it.resolvedCostPaise != null ? ((it.resolvedCostPaise + (it.additionalCostPaise ?? 0)) / 100) * gstMul : null,
        gstPct: it.gstRatePct,
        manual: it.barcodeIsManual,
        autoPrice: autoTag,
    };
}
