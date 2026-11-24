// Row types and pure price maths of Pricing → Update & print labels.
// Moved out of page.tsx unchanged.


import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import { formatInr } from "@/shared/lib/format";
import { afterGstProfit } from "@/shared/lib/pricing/profit";
import {
    barcodePrice as barcodePriceCore,
    normalizeBarcodeBands,
    DEFAULT_BARCODE_BANDS,
    type BarcodeBand,
} from "@/shared/lib/pricing/barcodePrice";
import { localDateOf } from "@/modules/inventory/lib/labelItems";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

// ── Cost methods (short code ↔ real CostMethod enum, for later wiring) ────────

export type CostCode = "WA" | "FO" | "SA" | "MA" | "LI";
// `enum` mirrors prisma CostMethod (costMethodEnum) — sent verbatim to the items PATCH.
export const COST_METHODS: { code: CostCode; full: string; enum: string }[] = [
    { code: "WA", full: "Weighted Avg", enum: "WEIGHTED_AVG" },
    { code: "FO", full: "FIFO", enum: "FIFO" },
    { code: "SA", full: "Simple Avg", enum: "SIMPLE_AVG" },
    { code: "MA", full: "Monthly Avg", enum: "MONTHLY_AVG" },
    { code: "LI", full: "Last Inward", enum: "LAST_INWARD" },
];
export const codeFromEnum = (e: string | null): CostCode =>
    COST_METHODS.find((m) => m.enum === e)?.code ?? "WA";
export const enumFromCode = (c: CostCode): string =>
    COST_METHODS.find((m) => m.code === c)?.enum ?? "WEIGHTED_AVG";

// ── Toggleable columns (show/hide) ───────────────────────────────────────────
// Name / # / select / remove are always shown; everything else can be hidden.
export type ColKey = "brand" | "category" | "group" | "stock" | "cost" | "margin" | "strategy" | "computed" | "sale" | "mrp" | "barcode";
export const COLS: { key: ColKey; label: string }[] = [
    { key: "brand", label: "Brand" },
    { key: "category", label: "Collection" },
    { key: "group", label: "Group" },
    { key: "stock", label: "Stock" },
    { key: "cost", label: "Cost + Method" },
    { key: "margin", label: "Margin %" },
    { key: "computed", label: "Computed" },
    { key: "strategy", label: "Strategy" },
    { key: "sale", label: "Fixed Price" },
    { key: "mrp", label: "MRP" },
    { key: "barcode", label: "Public Price" },
];

// ── Column colour groups (visual grouping only, no logic) ────────────────────
// Read-only/derived voices: neutral. Editable + persisted fields: amber tint.
// Print-facing outputs (what actually gets charged/printed): emerald tint.
export const COL_TINT: Partial<Record<ColKey, string>> = {
    stock: "bg-slate-50 dark:bg-slate-900/40",
    cost: "bg-slate-50 dark:bg-slate-900/40",
    computed: "bg-slate-50 dark:bg-slate-900/40",
    strategy: "bg-slate-50 dark:bg-slate-900/40",
    margin: "bg-amber-50 dark:bg-amber-950/20",
    sale: "bg-amber-50 dark:bg-amber-950/20",
    mrp: "bg-amber-50 dark:bg-amber-950/20",
    barcode: "bg-emerald-50 dark:bg-emerald-950/20",
};

// ── Row data (UI only) ───────────────────────────────────────────────────────

export type SaleSource = "STRATEGY" | "MY" | "SAVED";

export type Row = {
    id: number;
    name: string;
    sku: string;            // stock-keeping unit — shown under the name + searchable
    barcode: string;        // scannable EAN/SKU printed on the label (feeds the Print tab)
    codes: { kind: string; value: string }[]; // every scannable code (barcode+EAN+UPC) — search only
    brand: string;          // taxonomy — for the Brand filter (mirrors InvProduct.brand)
    category: string;       // taxonomy — for the Category filter
    group: string;          // taxonomy — for the Group filter
    stock: string;          // current stock (qty) — for the "in stock only" toggle + Stock range
    lastSoldAt: string;     // ISO date of the last sale; "" = never sold (infinite age) — Days since last sale range
    method: CostCode;
    costIncl: string;       // ₹ incl GST of the LANDED cost ((resolvedCostPaise + additional) × (1+gst)) — display + voice math. Read-only.
    additionalExcl: number; // per-unit shipping/courier surcharge (GST-excl paise) folded into costIncl. 0 = none.
    gst: string;            // GST % (resolved). Read-only.
    margin: string;         // % — drives the "Computed" voice. Editable → InvProduct.marginPercent.
    strategyPaise: number | null; // engine's exact Strategy-voice price (computedPricePaise), ₹·100. Authoritative.
    salePrice: string;      // Sale Price (sticky), user-editable; "" = not set
    baseline: string;       // last-saved Sale Price, for dirty detection
    mrp: string;            // MRP ceiling (incl GST). "" = no MRP
    baseMargin: string;     // last-saved Margin %, for dirty detection
    baseMrp: string;        // last-saved MRP, for dirty detection
    saleSource: SaleSource; // which voice actually sells
    baseSource: SaleSource; // last-saved sale source, for dirty detection
    savedAt: string;        // local date the printed barcode ₹ (manual/auto) last changed → secret date code
    barcodeManual: string;  // SAVED barcode ₹ (InvProduct.barcodeManualPaise); "" = never saved (legacy → derived)
    barcodeIsManual: boolean; // saved barcode was typed by hand (violet)
    baseBarcode: string;    // last-saved barcode ₹, for dirty detection + reset
    baseBarcodeIsManual: boolean;
    barcodeGapPct: number | null; // today's barcode gap as % of the gap at barcode save (server); null = not measurable
    temp: boolean;          // Fixed Price is "until next purchase" (InvProduct.tempPriceAfterLedgerId set)
    baseTemp: boolean;      // last-saved temp flag, for dirty detection
    tempSetAt: string;      // ISO time the temp Fixed Price was saved; "" = not temporary
    tempCancel: boolean;    // clock switched off on a SAVED temp price → server restores the original
    restoreSource: SaleSource | null; // saved temp: the choice that comes back after the next purchase
    restorePrice: string;   // saved temp: the Fixed Price ₹ that comes back; "" = none
};

// ── Map the engine's PricingItem → a table Row ────────────────────────────────
// Cost is GST-inclusive for display + voice math: costIncl = resolvedCostPaise
// (GST-exclusive) × (1 + gst/100). Because multiplication commutes,
//   costIncl × (1+margin) ≡ costExcl × (1+margin) × (1+gst)
// which is exactly what the engine computes — so the Computed voice matches POS.
// The Strategy voice uses the engine's own `computedPricePaise` verbatim.
export function isoDaysAgo(days: number | null): string {
    if (days == null) return "";
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// page "MY" ↔ db "COMPUTED"; STRATEGY/SAVED pass through.
export const voiceFromDb = (s: string): SaleSource => (s === "COMPUTED" ? "MY" : s === "SAVED" ? "SAVED" : "STRATEGY");
export const voiceToDb = (s: SaleSource): "STRATEGY" | "COMPUTED" | "SAVED" => (s === "MY" ? "COMPUTED" : s);

export function itemToRow(it: PricingItem): Row {
    const gst = it.gstRatePct ?? 0;
    // Landed cost basis = base resolved cost + per-unit additional (shipping)
    // cost from the Costing page, both GST-exclusive. Folded in before the
    // GST gross-up so the Computed voice + profit reflect true cost. The base
    // stays available separately via `additionalExcl` for the breakdown display.
    const additionalExcl = it.additionalCostPaise ?? 0;
    const landedExclPaise = it.resolvedCostPaise != null ? it.resolvedCostPaise + additionalExcl : null;
    const costInclRupees =
        landedExclPaise != null ? (landedExclPaise / 100) * (1 + gst / 100) : null;
    // Sale Price = the saved sale price ONLY (savedSalePricePaise). Blank when
    // nothing is set yet — never prefilled from another voice, because the
    // printed barcode is derived from this value and must reflect a real decision.
    const sale = it.savedSalePricePaise != null ? (it.savedSalePricePaise / 100).toFixed(2) : "";
    return {
        id: it.id,
        name: it.name,
        sku: it.sku ?? "",
        barcode: it.barcode ?? "",
        codes: it.codes ?? [],
        brand: it.brandName ?? "",
        category: it.categoryName ?? "",
        group: it.groupName ?? "",
        stock: it.stock != null ? String(it.stock) : "",
        lastSoldAt: isoDaysAgo(it.daysSinceLastSale),
        method: codeFromEnum(it.effectiveCostMethod),
        costIncl: costInclRupees != null ? costInclRupees.toFixed(2) : "",
        additionalExcl,
        gst: String(gst),
        margin: it.marginPercent != null ? String(it.marginPercent) : "",
        baseMargin: it.marginPercent != null ? String(it.marginPercent) : "",
        strategyPaise: it.computedPricePaise,
        salePrice: sale,
        baseline: sale,
        mrp: it.mrpPaise != null ? (it.mrpPaise / 100).toFixed(2) : "",
        baseMrp: it.mrpPaise != null ? (it.mrpPaise / 100).toFixed(2) : "",
        saleSource: voiceFromDb(it.effectiveSalePriceSource),
        baseSource: voiceFromDb(it.effectiveSalePriceSource),
        savedAt: localDateOf(it.salePriceFrozenAt),
        barcodeManual: it.barcodeManualPaise != null ? (it.barcodeManualPaise / 100).toFixed(2) : "",
        barcodeIsManual: it.barcodeIsManual,
        baseBarcode: it.barcodeManualPaise != null ? (it.barcodeManualPaise / 100).toFixed(2) : "",
        baseBarcodeIsManual: it.barcodeIsManual,
        barcodeGapPct: it.barcodeGapPct,
        temp: it.tempPriceSetAt != null,
        baseTemp: it.tempPriceSetAt != null,
        tempSetAt: it.tempPriceSetAt ?? "",
        tempCancel: false,
        restoreSource: it.tempRestoreSource ? voiceFromDb(it.tempRestoreSource) : null,
        restorePrice: it.tempRestoreSalePaise != null ? (it.tempRestoreSalePaise / 100).toFixed(2) : "",
    };
}

// ── Compute ──────────────────────────────────────────────────────────────────

// A voice price = cost × (1 + margin/100). Used for the Computed voice
// (margin). Exact value; rounding at voucher time. (Strategy voice comes from
// the engine — `Row.strategyPaise` — not this fn.)
export function priceWithMargin(costIncl: string, marginStr: string): number | null {
    const cost = parseFloat(costIncl);
    if (!isFinite(cost) || cost < 0) return null;
    const m = parseFloat(marginStr);
    if (!isFinite(m)) return null;
    return cost * (1 + m / 100);
}

// Reverse of priceWithMargin: the margin % that turns cost into `priceStr`.
// "" when it cannot be worked out (no cost, zero cost, or blank price). Kept to
// 2 decimals because InvProduct.marginPercent is Decimal(6,2).
export function marginFromPrice(costIncl: string, priceStr: string): string {
    const cost = parseFloat(costIncl);
    const price = parseFloat(priceStr);
    if (!isFinite(cost) || cost <= 0 || !isFinite(price)) return "";
    return String(Math.round((price / cost - 1) * 10000) / 100);
}

// The engine's Strategy-voice price in ₹ (from computedPricePaise), or null.
export function strategyRupees(r: Row): number | null {
    return r.strategyPaise != null ? r.strategyPaise / 100 : null;
}

// After-tax profit on a given selling price — shared formula (pricing/profit.ts).
export function profitOf(price: number | null, costIncl: string, gstStr: string): { amt: number; pct: number | null } | null {
    return afterGstProfit(price, parseFloat(costIncl), parseFloat(gstStr));
}

/** "2 Nov 26"; "" for no date. Parsed from "YYYY-MM-DD" (no timezone shift). */
export function shortDate(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return "";
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(m[2], 10) - 1];
    return `${parseInt(m[3], 10)} ${mon} ${m[1].slice(2)}`;
}

export const rupee = (n: number | null) => (n == null ? "—" : formatInr(n));

// ── Barcode price (the headroom price printed on the label) ───────────────────
//
// A band-based buffer is added to the Sale Price to leave room on the printed
// barcode. The buffered value is rounded to the nearest 10, then a "hint" digit
// (from the band) is set as the units digit — silently telling staff which band
// applied. Fallback: no band → barcode = sale price. MRP cap: when MRP is tight,
// the barcode floors to MRP (trailing 0 = capped); if even that drops below the
// sale price, print MRP exactly (token "m" → underlined). Bands live on
// OrgDefaults.barcodeBandsJson; the in-code default below is the seed fallback
// and is replaced at runtime by `setBarcodeBands()` once the config loads.

// Bands + the barcode algorithm live in the shared helper (single source of
// truth — the POS lookup API derives the same tag). This page keeps a thin
// module-level "active bands" slot it sets once from OrgDefaults on mount, and a
// local barcodePrice(price, mrp) that delegates with those bands so the many
// call sites below stay unchanged.
let ACTIVE_BARCODE_BANDS: BarcodeBand[] = DEFAULT_BARCODE_BANDS;
export function setBarcodeBands(bands: BarcodeBand[]) {
    ACTIVE_BARCODE_BANDS = normalizeBarcodeBands(bands);
}

export function barcodePrice(
    price: number | null,
    mrp: number | null = null,
): { value: number | null; hint: string; capped: boolean } {
    return barcodePriceCore(price, mrp, ACTIVE_BARCODE_BANDS);
}

// The row's printed barcode: the SAVED one when present (nothing but a barcode
// save moves it), else — a product never saved since this rule — derived from
// the saved Sale Price + MRP. Every barcode read on this page goes through here.
export function rowBarcode(r: Row): { value: number | null; hint: string; capped: boolean; manual: boolean } {
    const m = numOrNull(r.mrp);
    const mrp = m != null && m > 0 ? m : null;
    const stored = numOrNull(r.barcodeManual);
    if (stored != null) {
        const capped = mrp != null && stored >= mrp;
        // A saved AUTO barcode keeps its band hint as its units digit (that is how
        // the bands build it), so read it back from there. Hand-typed and
        // MRP-capped prices carry no hint ("m" when it is MRP exactly).
        const unit = String(Math.round(stored) % 10);
        const hint = r.barcodeIsManual ? "" : capped ? (mrp != null && Math.abs(stored - mrp) < 0.005 ? "m" : "0")
            : ACTIVE_BARCODE_BANDS.some((b) => String(b.hint) === unit) ? unit : "";
        return { value: stored, hint, capped, manual: r.barcodeIsManual };
    }
    const sp = numOrNull(r.baseline);
    if (sp == null) return { value: null, hint: "", capped: false, manual: false };
    return { ...barcodePrice(sp, mrp), manual: false };
}

// ── Sort ──────────────────────────────────────────────────────────────────────

export type SortKey = "name" | "brand" | "category" | "group" | "stock" | "cost" | "strategy" | "computed" | "saved" | "barcode";

/** The shadcn `TableHead` look, for the shared SortHeader cells in this table. */
export const SORT_TH = "h-11 px-3 align-middle whitespace-nowrap text-xs text-foreground";

export function sortVal(r: Row, key: SortKey): number | string {
    switch (key) {
        case "name": return r.name.toLowerCase();
        case "brand": return r.brand.toLowerCase();
        case "category": return r.category.toLowerCase();
        case "group": return r.group.toLowerCase();
        case "stock": { const v = parseFloat(r.stock); return isFinite(v) ? v : -Infinity; }
        case "cost": { const v = parseFloat(r.costIncl); return isFinite(v) ? v : -Infinity; }
        case "strategy": return strategyRupees(r) ?? -Infinity;
        case "computed": return priceWithMargin(r.costIncl, r.margin) ?? -Infinity;
        case "saved": { const v = parseFloat(r.salePrice); return isFinite(v) ? v : -Infinity; }
        case "barcode": return rowBarcode(r).value ?? -Infinity;
    }
}

// ── Range filters (numeric parameters: min/max) ───────────────────────────────

export type RangeKey = "profit" | "profitPct" | "daysSinceSale" | "barcodeGap";
export const RANGE_FIELDS: { key: RangeKey; label: string; unit?: string }[] = [
    { key: "profit", label: "Profit ₹ (sale price)", unit: "₹" },
    // Same figure as Needs Attention → Low barcode gap: today's gap (barcode −
    // selling price) as % of the gap when the barcode was saved. "Below 30" = that list.
    { key: "barcodeGap", label: "Public Price gap % of original", unit: "%" },
    { key: "daysSinceSale", label: "Days since last sale", unit: "days" },
    { key: "profitPct", label: "Profit % (sale price)", unit: "%" },
];

// Filter-card order for the Ranges row (owner's layout). The barcode gap's two
// separate sides (Below = max, Above = min) sit in the Quick checks row instead.
export const RANGE_GRID: Exclude<RangeKey, "barcodeGap">[] =
    ["profit", "profitPct", "daysSinceSale"];
export const RANGE_LABEL = Object.fromEntries(RANGE_FIELDS.map((f) => [f.key, f])) as Record<RangeKey, (typeof RANGE_FIELDS)[number]>;

// localStorage key for the persisted ("saved") filter state. Bump the suffix
// when the persisted shape changes so old blobs are ignored, not mis-applied.
export const FILTER_STORAGE_KEY = "pricing.update-print-labels.filters.v1";

export const SOURCE_OPTIONS = [
    { value: "STRATEGY", label: "Strategy" },
    { value: "MY", label: "Computed" },
    { value: "SAVED", label: "Fixed Price" },
];

export const numOrNull = (s: string): number | null => {
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
};

// min ≤ max → keep inside [min, max]. min > max → keep OUTSIDE the middle:
// at most max OR at least min (e.g. max 10, min 80 → 0–10 and 80–100).
export const inRange = (val: number | null, lo: number | null, hi: number | null): boolean => {
    if (val == null) return false;
    if (lo != null && hi != null && lo > hi) return val <= hi || val >= lo;
    return (lo == null || val >= lo) && (hi == null || val <= hi);
};

// The price of the voice marked SELLING (Strategy / Computed / Sale Price),
// before the barcode/MRP cap — what the row is set to sell at.
export function sellingVoice(r: Row): number | null {
    return r.saleSource === "STRATEGY" ? strategyRupees(r)
        : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.margin)
            : numOrNull(r.salePrice);
}

// The "applicable" sale price = the chosen voice, capped by the barcode price and MRP.
export function applicableSalePrice(r: Row): number | null {
    const chosen = sellingVoice(r);
    if (chosen == null) return null;
    let val = chosen;
    const m = numOrNull(r.mrp);
    const bc = rowBarcode(r).value;
    if (bc != null) val = Math.min(val, bc);
    if (m != null && m > 0) val = Math.min(val, m);
    return val;
}

// Barcode capped = the printed barcode was clamped to MRP (MRP is squeezing the
// barcode's headroom). The sale price itself may still be healthy.
export function barcodeCapped(r: Row): boolean {
    return rowBarcode(r).capped;
}

// Sale price capped = the selling voice itself had to be held down by the
// barcode/MRP ceiling (applicable price < the chosen voice).
export function saleCapped(r: Row): boolean {
    const chosen = sellingVoice(r);
    if (chosen == null) return false;
    const applic = applicableSalePrice(r);
    return applic != null && applic < chosen - 0.005;
}

// A row has an unsaved FREEZE decision when its Sale Price OR its selling source
// differs from what was last saved. (Margin/MRP/method aren't here — they persist
// on their own as you edit; the Save button only commits the freeze decision.)
// Amounts compare as numbers (paise for ₹, 4 places for %), so "5644" and
// "5644.00" are the same price and a row typed back to its saved amount is clean.
export const sameAmount = (a: string, b: string, scale = 100): boolean => {
    const x = numOrNull(a), y = numOrNull(b);
    return x == null || y == null ? x === y : Math.round(x * scale) === Math.round(y * scale);
};
export const marginDirty = (r: Row) => !sameAmount(r.margin, r.baseMargin, 10_000);
export const mrpDirty = (r: Row) => !sameAmount(r.mrp, r.baseMrp);
export const barcodeDirty = (r: Row) => !sameAmount(r.barcodeManual, r.baseBarcode);
// Puts a row's editable boxes back to the last saved values (no DB call).
export const resetRow = (r: Row): Row => ({ ...r, salePrice: r.baseline, saleSource: r.baseSource, margin: r.baseMargin, mrp: r.baseMrp, barcodeManual: r.baseBarcode, barcodeIsManual: r.baseBarcodeIsManual, temp: r.baseTemp, tempCancel: false });
// Computed (margin), Sale Price, MRP, Barcode and the selling choice all wait for Save prices.
export const rowDirty = (r: Row): boolean =>
    !sameAmount(r.salePrice, r.baseline) || r.saleSource !== r.baseSource || marginDirty(r) || mrpDirty(r) || barcodeDirty(r) || r.temp !== r.baseTemp || r.tempCancel;

export const stockQty = (r: Row): number => numOrNull(r.stock) ?? 0;

// Whole days between the last sale and today. Never-sold rows ("") have infinite
// age — they match a lower bound but fail any upper bound (mirrors the strategy engine).
export function daysSinceSale(r: Row): number {
    if (!r.lastSoldAt) return Infinity;
    const sold = new Date(`${r.lastSoldAt}T00:00:00`);
    if (isNaN(sold.getTime())) return Infinity;
    const now = new Date(`${businessTodayIso()}T00:00:00`);
    return Math.floor((now.getTime() - sold.getTime()) / 86_400_000);
}

// The numeric value of a row for a given range parameter.
export function rangeVal(r: Row, key: RangeKey): number | null {
    switch (key) {
        case "daysSinceSale": return daysSinceSale(r);
        case "barcodeGap": return r.barcodeGapPct;
        case "profit": {
            // After-tax profit on the price that actually applies (capped selling voice).
            const price = applicableSalePrice(r);
            if (price == null) return null;
            return profitOf(price, r.costIncl, r.gst)?.amt ?? null;
        }
        case "profitPct": {
            const price = applicableSalePrice(r);
            if (price == null) return null;
            return profitOf(price, r.costIncl, r.gst)?.pct ?? null;
        }
    }
}


// ── Voice cell (clickable price chip) ─────────────────────────────────────────

// `clickable` = the chip itself switches the selling voice (Strategy / Computed).
// The Sale Price cell passes false: it holds an editable input, so clicking or
// tabbing into it must NOT silently move the selling voice — its own small
// "use as lowest" link does that. (The separate Selling dropdown column is gone.)
export function voiceClass(selected: boolean, clickable = true): string {
    return `w-full rounded px-1.5 py-1 text-right transition-colors ${selected ? "bg-emerald-50 ring-1 ring-emerald-400" : clickable ? "cursor-pointer hover:bg-muted" : ""
        }`;
}


// The temporary Fixed Price's ORIGIN — what comes back after the next purchase.
// A saved temp remembers it on the server; an unsaved one is the last-saved row.
export const VOICE_NAME: Record<SaleSource, string> = { MY: "Computed", STRATEGY: "Strategy", SAVED: "Fixed Price" };
export function tempOrigin(r: Row): { source: SaleSource; fixed: string } | null {
    if (!r.temp) return null;
    return r.baseTemp
        ? { source: r.restoreSource ?? "STRATEGY", fixed: r.restorePrice }
        : { source: r.baseSource, fixed: r.baseline };
}
