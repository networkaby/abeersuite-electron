"use client";

/**
 * Update & Print Labels — the price-generation step that feeds the barcode labels.
 *
 * DATA (wired to the live engine):
 *   • Products + cost + Strategy/Computed voices ← GET /api/pricing-strategy/items?withSaleAge=1
 *   • Barcode bands ← OrgDefaults.barcodeBandsJson (GET /api/settings/org-defaults)
 *
 * A product has THREE price "voices":
 *   • Strategy — the winning pricing-strategy rule's output (engine `computedPricePaise`). LIVE.
 *   • Computed — cost × my margin. LIVE (floats with cost).
 *   • Sale Price — the sticky, human-frozen price (NOT yet persisted — Phase C).
 *
 * You pick which voice actually sells by CLICKING it — the highlighted one is the
 * selling price. POS makes no decision; it just charges that voice, capped by the
 * barcode price and MRP (cap not shown as its own column — see Barcode).
 *
 * EDITABLE + persisted (PATCH /api/pricing-strategy/items/[id]): Computed price
 *   (typed; Margin % is derived from it, read-only) →
 * marginPercent, MRP → mrpPaise, Method → costMethod. Everything else (name,
 * taxonomy, stock, cost, GST, Strategy voice, days-since-sale, barcode) is
 * read-only/derived. Cost is GST-inclusive; because cost_incl × (1+margin) equals
 * the engine's cost_excl × (1+margin) × (1+gst), the Computed voice matches POS.
 *
 * The barcode price is computed from the Sale Price (buffer band + hint digit,
 * MRP-capped) and acts as a CEILING — never the charge. Each voice shows its own
 * AFTER-TAX profit (₹ + %) beneath the price, so all three can be compared.
 *
 *   voicePrice = cost_incl × (1 + margin% / 100)
 */

import { type ReactNode, memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import { formatInr, gridRowClass, parseDecimalInput } from "@/shared/lib/format";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { barcodePrice as barcodePriceCore, normalizeBarcodeBands, DEFAULT_BARCODE_BANDS, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { productMatchesSearch } from "@/shared/lib/inventory";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { todayISO } from "@/modules/inventory/lib/labelItems";
import { secretDateCode } from "@/modules/inventory/lib/secretDateCode";
import { useLabelPrintStore } from "@/store/labelPrintStore";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Filter, Loader2, Plus, Printer, RotateCcw, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { useTableSort } from "@/shared/hooks/useTableSort";
import { SortHeader } from "@/shared/components/SortHeader";

// ── Cost methods (short code ↔ real CostMethod enum, for later wiring) ────────

type CostCode = "WA" | "FO" | "SA" | "MA" | "LI";
// `enum` mirrors prisma CostMethod (costMethodEnum) — sent verbatim to the items PATCH.
const COST_METHODS: { code: CostCode; full: string; enum: string }[] = [
    { code: "WA", full: "Weighted Avg", enum: "WEIGHTED_AVG" },
    { code: "FO", full: "FIFO", enum: "FIFO" },
    { code: "SA", full: "Simple Avg", enum: "SIMPLE_AVG" },
    { code: "MA", full: "Monthly Avg", enum: "MONTHLY_AVG" },
    { code: "LI", full: "Last Inward", enum: "LAST_INWARD" },
];
const codeFromEnum = (e: string | null): CostCode =>
    COST_METHODS.find((m) => m.enum === e)?.code ?? "WA";
const enumFromCode = (c: CostCode): string =>
    COST_METHODS.find((m) => m.code === c)?.enum ?? "WEIGHTED_AVG";

// ── Toggleable columns (show/hide) ───────────────────────────────────────────
// Name / # / select / remove are always shown; everything else can be hidden.
type ColKey = "brand" | "category" | "group" | "stock" | "cost" | "margin" | "strategy" | "computed" | "sale" | "selling" | "mrp" | "barcode";
const COLS: { key: ColKey; label: string }[] = [
    { key: "brand", label: "Brand" },
    { key: "category", label: "Collection" },
    { key: "group", label: "Group" },
    { key: "stock", label: "Stock" },
    { key: "cost", label: "Cost + Method" },
    { key: "margin", label: "Margin %" },
    { key: "computed", label: "Computed" },
    { key: "strategy", label: "Strategy" },
    { key: "sale", label: "Sale Price" },
    { key: "selling", label: "Selling" },
    { key: "mrp", label: "MRP" },
    { key: "barcode", label: "Barcode" },
];

// ── Column colour groups (visual grouping only, no logic) ────────────────────
// Read-only/derived voices: neutral. Editable + persisted fields: amber tint.
// Print-facing outputs (what actually gets charged/printed): emerald tint.
const COL_TINT: Partial<Record<ColKey, string>> = {
    stock: "bg-slate-50 dark:bg-slate-900/40",
    cost: "bg-slate-50 dark:bg-slate-900/40",
    computed: "bg-slate-50 dark:bg-slate-900/40",
    strategy: "bg-slate-50 dark:bg-slate-900/40",
    margin: "bg-amber-50 dark:bg-amber-950/20",
    sale: "bg-amber-50 dark:bg-amber-950/20",
    mrp: "bg-amber-50 dark:bg-amber-950/20",
    selling: "bg-emerald-50 dark:bg-emerald-950/20",
    barcode: "bg-emerald-50 dark:bg-emerald-950/20",
};

// ── Row data (UI only) ───────────────────────────────────────────────────────

type SaleSource = "STRATEGY" | "MY" | "SAVED";

type Row = {
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
    strategyMargin: string; // % — the matched strategy's applied markup (for the Margin range filter).
    strategyPaise: number | null; // engine's exact Strategy-voice price (computedPricePaise), ₹·100. Authoritative.
    salePrice: string;      // Sale Price (sticky), user-editable; "" = not set
    baseline: string;       // last-saved Sale Price, for dirty detection
    mrp: string;            // MRP ceiling (incl GST). "" = no MRP
    saleSource: SaleSource; // which voice actually sells
    baseSource: SaleSource; // last-saved sale source, for dirty detection
    savedAt: string;        // ISO date the Sale Price was last frozen → barcode date code
    savedProfit: string;    // decided profit ₹ frozen at last save → basis for the profit-gap filter
};

// ── Map the engine's PricingItem → a table Row ────────────────────────────────
// Cost is GST-inclusive for display + voice math: costIncl = resolvedCostPaise
// (GST-exclusive) × (1 + gst/100). Because multiplication commutes,
//   costIncl × (1+margin) ≡ costExcl × (1+margin) × (1+gst)
// which is exactly what the engine computes — so the Computed voice matches POS.
// The Strategy voice uses the engine's own `computedPricePaise` verbatim.
function isoDaysAgo(days: number | null): string {
    if (days == null) return "";
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// page "MY" ↔ db "COMPUTED"; STRATEGY/SAVED pass through.
const voiceFromDb = (s: string): SaleSource => (s === "COMPUTED" ? "MY" : s === "SAVED" ? "SAVED" : "STRATEGY");
const voiceToDb = (s: SaleSource): "STRATEGY" | "COMPUTED" | "SAVED" => (s === "MY" ? "COMPUTED" : s);

function itemToRow(it: PricingItem): Row {
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
        strategyMargin: String(it.appliedMarkupPct ?? 0),
        strategyPaise: it.computedPricePaise,
        salePrice: sale,
        baseline: sale,
        mrp: it.mrpPaise != null ? (it.mrpPaise / 100).toFixed(2) : "",
        saleSource: voiceFromDb(it.effectiveSalePriceSource),
        baseSource: voiceFromDb(it.effectiveSalePriceSource),
        savedAt: it.salePriceFrozenAt ? it.salePriceFrozenAt.slice(0, 10) : "",
        savedProfit: it.savedProfitPaise != null ? (it.savedProfitPaise / 100).toFixed(2) : "",
    };
}

// ── Compute ──────────────────────────────────────────────────────────────────

// A voice price = cost × (1 + margin/100). Used for the Computed voice
// (margin). Exact value; rounding at voucher time. (Strategy voice comes from
// the engine — `Row.strategyPaise` — not this fn.)
function priceWithMargin(costIncl: string, marginStr: string): number | null {
    const cost = parseFloat(costIncl);
    if (!isFinite(cost) || cost < 0) return null;
    const m = parseFloat(marginStr);
    if (!isFinite(m)) return null;
    return cost * (1 + m / 100);
}

// Reverse of priceWithMargin: the margin % that turns cost into `priceStr`.
// "" when it cannot be worked out (no cost, zero cost, or blank price). Kept to
// 2 decimals because InvProduct.marginPercent is Decimal(6,2).
function marginFromPrice(costIncl: string, priceStr: string): string {
    const cost = parseFloat(costIncl);
    const price = parseFloat(priceStr);
    if (!isFinite(cost) || cost <= 0 || !isFinite(price)) return "";
    return String(Math.round((price / cost - 1) * 10000) / 100);
}

// The engine's Strategy-voice price in ₹ (from computedPricePaise), or null.
function strategyRupees(r: Row): number | null {
    return r.strategyPaise != null ? r.strategyPaise / 100 : null;
}

// After-tax profit on a given selling price: strip GST from both sale and cost
// (output GST owed, input GST reclaimed). pct = margin on net sale.
function profitOf(
    price: number | null,
    costIncl: string,
    gstStr: string,
): { amt: number; pct: number | null } | null {
    if (price == null) return null;
    const cost = parseFloat(costIncl);
    if (!isFinite(cost)) return null;
    const gst = parseFloat(gstStr);
    const gstMul = isFinite(gst) && gst > 0 ? 1 + gst / 100 : 1;
    const netSale = price / gstMul;
    const netCost = cost / gstMul;
    const amt = netSale - netCost;
    const pct = netSale > 0 ? (amt / netSale) * 100 : null;
    return { amt, pct };
}

const rupee = (n: number | null) => (n == null ? "—" : formatInr(n));

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
function setBarcodeBands(bands: BarcodeBand[]) {
    ACTIVE_BARCODE_BANDS = normalizeBarcodeBands(bands);
}

function barcodePrice(
    price: number | null,
    mrp: number | null = null,
): { value: number | null; hint: string; capped: boolean } {
    return barcodePriceCore(price, mrp, ACTIVE_BARCODE_BANDS);
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "name" | "brand" | "category" | "group" | "stock" | "cost" | "strategy" | "computed" | "saved" | "barcode";

/** The shadcn `TableHead` look, for the shared SortHeader cells in this table. */
const SORT_TH = "h-11 px-3 align-middle whitespace-nowrap text-xs text-foreground";

function sortVal(r: Row, key: SortKey): number | string {
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
        case "barcode": {
            const v = parseFloat(r.salePrice);
            const sp = isFinite(v) ? v : null;
            if (sp == null) return -Infinity;
            const mn = parseFloat(r.mrp);
            const mrp = isFinite(mn) && mn > 0 ? mn : null;
            return barcodePrice(sp, mrp).value ?? -Infinity;
        }
    }
}

// ── Range filters (numeric parameters: min/max) ───────────────────────────────

type RangeKey = "cost" | "margin" | "profit" | "profitPct" | "stock" | "daysSinceSale";
const RANGE_FIELDS: { key: RangeKey; label: string }[] = [
    { key: "cost", label: "Cost (incl)" },
    { key: "margin", label: "Margin % (strategy & mine)" },
    { key: "profit", label: "Profit ₹ (sale price)" },
    { key: "profitPct", label: "Profit % (sale price)" },
    { key: "stock", label: "Stock (units)" },
    { key: "daysSinceSale", label: "Days since last sale" },
];

// localStorage key for the persisted ("saved") filter state. Bump the suffix
// when the persisted shape changes so old blobs are ignored, not mis-applied.
const FILTER_STORAGE_KEY = "pricing.update-print-labels.filters.v1";

const SOURCE_OPTIONS = [
    { value: "STRATEGY", label: "Strategy" },
    { value: "MY", label: "Computed" },
    { value: "SAVED", label: "Sale Price" },
];

const numOrNull = (s: string): number | null => {
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
};

const inRange = (val: number | null, lo: number | null, hi: number | null): boolean =>
    val != null && (lo == null || val >= lo) && (hi == null || val <= hi);

// The "applicable" sale price = the chosen voice, capped by the barcode price and MRP.
function applicableSalePrice(r: Row): number | null {
    const saved = numOrNull(r.salePrice);
    const chosen =
        r.saleSource === "STRATEGY" ? strategyRupees(r)
            : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.margin)
                : saved;
    if (chosen == null) return null;
    let val = chosen;
    const m = numOrNull(r.mrp);
    if (saved != null) {
        const bc = barcodePrice(saved, m != null && m > 0 ? m : null).value;
        if (bc != null) val = Math.min(val, bc);
    }
    if (m != null && m > 0) val = Math.min(val, m);
    return val;
}

// Barcode capped = the printed barcode was clamped to MRP (MRP is squeezing the
// barcode's headroom). The sale price itself may still be healthy.
function barcodeCapped(r: Row): boolean {
    const sp = numOrNull(r.salePrice);
    if (sp == null) return false;
    const m = numOrNull(r.mrp);
    return barcodePrice(sp, m != null && m > 0 ? m : null).capped;
}

// Sale price capped = the selling voice itself had to be held down by the
// barcode/MRP ceiling (applicable price < the chosen voice).
function saleCapped(r: Row): boolean {
    const saved = numOrNull(r.salePrice);
    const chosen =
        r.saleSource === "STRATEGY" ? strategyRupees(r)
            : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.margin)
                : saved;
    if (chosen == null) return false;
    const applic = applicableSalePrice(r);
    return applic != null && applic < chosen - 0.005;
}

// A row has an unsaved FREEZE decision when its Sale Price OR its selling source
// differs from what was last saved. (Margin/MRP/method aren't here — they persist
// on their own as you edit; the Save button only commits the freeze decision.)
const rowDirty = (r: Row): boolean =>
    r.salePrice.trim() !== r.baseline.trim() || r.saleSource !== r.baseSource;

const stockQty = (r: Row): number => numOrNull(r.stock) ?? 0;

// Whole days between the last sale and today. Never-sold rows ("") have infinite
// age — they match a lower bound but fail any upper bound (mirrors the strategy engine).
function daysSinceSale(r: Row): number {
    if (!r.lastSoldAt) return Infinity;
    const sold = new Date(`${r.lastSoldAt}T00:00:00`);
    if (isNaN(sold.getTime())) return Infinity;
    const now = new Date(`${todayISO()}T00:00:00`);
    return Math.floor((now.getTime() - sold.getTime()) / 86_400_000);
}

// The numeric value of a row for a given range parameter. The Margin range is
// special-cased in the filter loop (it checks BOTH strategy & user margin).
function rangeVal(r: Row, key: RangeKey): number | null {
    switch (key) {
        case "cost": return numOrNull(r.costIncl);
        case "margin": return numOrNull(r.margin);
        case "stock": return numOrNull(r.stock);
        case "daysSinceSale": return daysSinceSale(r);
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

// ── Drift signals (computed against the frozen print-time snapshot) ────────────

// Barcode gap shrink %: how far the (live) selling voice has climbed ABOVE the
// frozen saved price, as % of the printed barcode. Bigger = the live price is
// eating the barcode's headroom (heading toward stale). 0 when selling at SAVED.
function barcodeShrinkPct(r: Row): number | null {
    const saved = numOrNull(r.salePrice);
    if (saved == null) return null;
    const m = numOrNull(r.mrp);
    const bc = barcodePrice(saved, m != null && m > 0 ? m : null).value;
    if (bc == null || bc === 0) return null;
    const live =
        r.saleSource === "STRATEGY" ? strategyRupees(r)
            : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.margin)
                : saved;
    if (live == null) return null;
    return ((live - saved) / bc) * 100;
}

// Profit gap %: current profit on the saved price vs the DECIDED profit frozen at
// print. Negative = profit reduced, positive = profit increased.
function profitGapPct(r: Row): number | null {
    const decided = numOrNull(r.savedProfit);
    const saved = numOrNull(r.salePrice);
    if (decided == null || decided === 0 || saved == null) return null;
    const cur = profitOf(saved, r.costIncl, r.gst)?.amt;
    if (cur == null) return null;
    return ((cur - decided) / Math.abs(decided)) * 100;
}

// ── Voice cell (clickable price chip) ─────────────────────────────────────────

// `clickable` = the chip itself switches the selling voice (Strategy / Computed).
// The Sale Price cell passes false: it holds an editable input, so clicking or
// tabbing into it must NOT silently move the selling voice — that flip is the
// Selling dropdown's job alone.
function voiceClass(selected: boolean, clickable = true): string {
    return `w-full rounded px-1.5 py-1 text-right transition-colors ${selected ? "bg-emerald-50 ring-1 ring-emerald-400" : clickable ? "cursor-pointer hover:bg-muted" : ""
        }`;
}

const SELLING_TAG = (
    <span className="mb-0.5 flex items-center justify-end gap-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600">
        <Check className="size-2.5" /> selling
    </span>
);

const ProfitSub = ({ p }: { p: { amt: number; pct: number | null } | null }) =>
    p == null ? (
        <span className="block text-[10px] text-muted-foreground">—</span>
    ) : (
        <span className={`block text-[10px] font-mono ${p.amt < 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {rupee(p.amt)}{p.pct != null ? ` · ${p.pct.toFixed(1)}%` : ""}
        </span>
    );

type RowPersistPatch = { marginPercent?: number | null; mrpPaise?: number | null; costMethod?: string };

// Memoized row — only re-renders when its own `r`, `selected`, or column
// visibility (`hidden`) changes. With ~hundreds of rows this keeps typing in one
// cell from re-rendering the whole table. Requires stable callback props +
// stable `r` references for unchanged rows (setRows keeps them via the ternary).
const ProductRow = memo(function ProductRow({
    r, index, hidden, selected,
    onUpdate, onPersist, onToggleSel, onRemove, removeTitle,
}: {
    r: Row;
    index: number;
    hidden: Set<ColKey>;
    selected: boolean;
    onUpdate: (id: number, patch: Partial<Row>) => void;
    onPersist: (id: number, patch: RowPersistPatch, opts?: { reload?: boolean }) => void;
    onToggleSel: (id: number) => void;
    onRemove: (id: number) => void;
    /** What the trash button does on this tab — it differs (see `remove`). */
    removeTitle: string;
}) {
    const show = (k: ColKey) => !hidden.has(k);
    const strategyPrice = strategyRupees(r);
    const myPrice = priceWithMargin(r.costIncl, r.margin);
    // While the Computed box is focused it shows exactly what was typed (not the
    // re-derived price, which could drift a paisa from the 2-dp margin).
    const [computedDraft, setComputedDraft] = useState<string | null>(null);
    const [marginAtFocus, setMarginAtFocus] = useState(r.margin);
    const savedNum = parseFloat(r.salePrice);
    const savedPrice = isFinite(savedNum) ? savedNum : null;
    const mrpNum = parseFloat(r.mrp);
    const mrp = isFinite(mrpNum) && mrpNum > 0 ? mrpNum : null;
    const bc = savedPrice != null ? barcodePrice(savedPrice, mrp) : null;
    const dateCode = secretDateCode(r.savedAt);
    const stratProfit = profitOf(strategyPrice, r.costIncl, r.gst);
    const myProfit = profitOf(myPrice, r.costIncl, r.gst);
    const savedProfit = profitOf(savedPrice, r.costIncl, r.gst);
    // Same test the Save button counts with (rowDirty) — a Selling switch with no
    // price edit is an unsaved decision too, and must carry the amber mark.
    const dirty = rowDirty(r);

    return (
        <TableRow className={gridRowClass({ selected, dirty, odd: index % 2 === 1 })}>
            <TableCell>
                <div className="flex items-center gap-1">
                    <Checkbox checked={selected} onCheckedChange={() => onToggleSel(r.id)} aria-label={`Select ${r.name}`} />
                    {/* The amber circle both MARKS the unsaved row and undoes it — one
                        click puts Sale Price + Selling back to the last saved values, so
                        the row drops out of the Save count without any DB call. */}
                    {dirty ? (
                        <button
                            type="button"
                            onClick={() => onUpdate(r.id, { salePrice: r.baseline, saleSource: r.baseSource })}
                            className="rounded-full p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
                            title="Unsaved change — click to reset this row (Sale Price + Selling)"
                            aria-label={`Reset ${r.name}`}
                        >
                            <RotateCcw className="size-3.5" />
                        </button>
                    ) : null}
                </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
            <TableCell className="max-w-[320px] text-xs font-medium" title={r.sku ? `${r.name} · ${r.sku}` : r.name}>
                <div className="truncate">{r.name}</div>
                {r.sku ? <div className="truncate text-[10px] font-normal text-muted-foreground">{r.sku}</div> : null}
            </TableCell>
            {show("brand") ? <TableCell className="text-xs text-muted-foreground">{r.brand || "—"}</TableCell> : null}
            {show("category") ? <TableCell className="text-xs text-muted-foreground">{r.category || "—"}</TableCell> : null}
            {show("group") ? <TableCell className="text-xs text-muted-foreground">{r.group || "—"}</TableCell> : null}
            {show("stock") ? (
                <TableCell className={`text-right text-xs font-mono ${COL_TINT.stock} ${stockQty(r) <= 0 ? "text-red-600" : ""}`}>
                    {r.stock === "" ? "—" : r.stock}
                </TableCell>
            ) : null}
            {show("cost") ? (
                <TableCell className={`align-top ${COL_TINT.cost}`}>
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs font-mono text-muted-foreground">
                            {r.costIncl === "" ? "—" : `₹${r.costIncl}`}
                        </span>
                        {r.additionalExcl > 0 ? (
                            <span
                                className="text-[10px] font-mono text-violet-700 dark:text-violet-300"
                                title="Includes per-unit shipping/courier cost (GST-excl) from the Costing page"
                            >
                                incl +₹{(r.additionalExcl / 100).toFixed(2)} ship
                            </span>
                        ) : null}
                        <Select
                            value={r.method}
                            onValueChange={(v) => {
                                onUpdate(r.id, { method: v as CostCode });
                                onPersist(r.id, { costMethod: enumFromCode(v as CostCode) }, { reload: true });
                            }}
                        >
                            <SelectTrigger className="h-6 w-16 text-xs font-mono"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {COST_METHODS.map((m) => (
                                    <SelectItem key={m.code} value={m.code}>
                                        <span className="font-mono">{m.code}</span>
                                        <span className="ml-2 text-muted-foreground">{m.full}</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </TableCell>
            ) : null}
            {show("margin") ? (
                <TableCell className={`text-right ${COL_TINT.margin}`}>
                    {/* Read-only: worked out from the price typed in Computed. */}
                    <span className="text-xs font-mono">{r.margin === "" ? "—" : `${r.margin}%`}</span>
                </TableCell>
            ) : null}

            {show("computed") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.computed}`}>
                    <div className={voiceClass(r.saleSource === "MY")} onClick={() => onUpdate(r.id, { saleSource: "MY" })}>
                        {r.saleSource === "MY" ? SELLING_TAG : null}
                        {/* Type the price; Margin % is derived from it and saved. */}
                        <Input
                            type="text"
                            inputMode="decimal"
                            value={computedDraft ?? (myPrice != null ? myPrice.toFixed(2) : "")}
                            placeholder="—"
                            disabled={!(parseFloat(r.costIncl) > 0)}
                            onFocus={() => { setMarginAtFocus(r.margin); setComputedDraft(myPrice != null ? myPrice.toFixed(2) : ""); }}
                            onChange={(e) => {
                                const v = parseDecimalInput(e.target.value);
                                setComputedDraft(v);
                                onUpdate(r.id, { margin: marginFromPrice(r.costIncl, v), saleSource: "MY" });
                            }}
                            onBlur={() => {
                                setComputedDraft(null);
                                if (r.margin !== marginAtFocus) onPersist(r.id, { marginPercent: numOrNull(r.margin) });
                            }}
                            className="h-7 w-24 ml-auto text-right text-sm font-mono font-semibold"
                        />
                        <ProfitSub p={myProfit} />
                    </div>
                </TableCell>
            ) : null}

            {show("strategy") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.strategy}`}>
                    <button type="button" className={voiceClass(r.saleSource === "STRATEGY")} onClick={() => onUpdate(r.id, { saleSource: "STRATEGY" })}>
                        {r.saleSource === "STRATEGY" ? SELLING_TAG : null}
                        <span className="block text-sm font-mono font-semibold">{rupee(strategyPrice)}</span>
                        <ProfitSub p={stratProfit} />
                    </button>
                </TableCell>
            ) : null}

            {show("sale") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.sale}`}>
                    <div className={voiceClass(r.saleSource === "SAVED", false)}>
                        {r.saleSource === "SAVED" ? SELLING_TAG : null}
                        <Input
                            inputMode="decimal"
                            value={r.salePrice}
                            placeholder="—"
                            onChange={(e) => onUpdate(r.id, { salePrice: e.target.value })}
                            className={`h-7 w-24 text-right text-xs font-mono font-semibold ${dirty ? "ring-1 ring-amber-400 focus-visible:ring-amber-400" : ""}`}
                        />
                        <ProfitSub p={savedProfit} />
                    </div>
                </TableCell>
            ) : null}

            {show("selling") ? (
                <TableCell className={`text-right ${COL_TINT.selling}`}>
                    {/* The one deliberate control for which voice POS/shop charges.
                        Editing Sale Price no longer moves it — you pick it here. */}
                    <Select value={r.saleSource} onValueChange={(v) => onUpdate(r.id, { saleSource: v as SaleSource })}>
                        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="STRATEGY">Strategy</SelectItem>
                            <SelectItem value="MY">Computed</SelectItem>
                            <SelectItem value="SAVED" disabled={savedPrice == null}>Sale Price</SelectItem>
                        </SelectContent>
                    </Select>
                </TableCell>
            ) : null}

            {show("mrp") ? (
                <TableCell className={`text-right ${COL_TINT.mrp}`}>
                    <Input
                        inputMode="decimal"
                        value={r.mrp}
                        placeholder="—"
                        onChange={(e) => onUpdate(r.id, { mrp: e.target.value })}
                        onBlur={() => { const v = numOrNull(r.mrp); onPersist(r.id, { mrpPaise: v != null ? Math.round(v * 100) : null }); }}
                        className="h-7 w-20 text-right text-xs font-mono"
                    />
                </TableCell>
            ) : null}

            {show("barcode") ? (
                <TableCell className={`text-right ${COL_TINT.barcode}`}>
                    {bc == null || bc.value == null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                        <span className="inline-flex items-baseline justify-end gap-1">
                            <span
                                className={`text-sm font-mono font-semibold ${bc.capped ? "text-amber-600" : ""} ${bc.hint === "m" ? "underline decoration-2 underline-offset-2" : ""}`}
                                title={bc.capped ? (bc.hint === "m" ? "Capped at MRP exactly (no markup room)" : "Capped at MRP — no markup room") : undefined}
                            >
                                {rupee(bc.value)}
                                {bc.hint && bc.hint !== "m" ? <span className="ml-1 text-[10px] text-muted-foreground">·{bc.hint}</span> : null}
                            </span>
                            {dateCode ? (
                                <span className="rounded bg-muted px-1 text-[10px] font-mono text-muted-foreground" title={`Barcode date code — frozen ${r.savedAt} (MM + 10-day third)`}>
                                    {dateCode}
                                </span>
                            ) : null}
                        </span>
                    )}
                </TableCell>
            ) : null}

            <TableCell>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={removeTitle} title={removeTitle} onClick={() => onRemove(r.id)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                </Button>
            </TableCell>
        </TableRow>
    );
});

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GeneratePage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    // Client-side pagination of the rendered rows (pageSize 0 = show All).
    const [pageSize, setPageSize] = useState(150);
    const [pageIndex, setPageIndex] = useState(0);
    // Top tab (All products / Selected product) + the working "selection".
    const [tab, setTab] = useState<"all" | "selected">("all");

    const router = useRouter();
    // "Go to Print" only for someone who may open Print labels (the page lock).
    const canOpen = useCanOpenPage();
    const searchParams = useSearchParams();
    // ?view=selected — arriving from the Print labels page to price the queued
    // products. Same shared queue, so the Selected tab already holds them.
    const view = searchParams.get("view");
    if (useValueChange(view, null) && view === "selected") setTab("selected");

    // ── Load real products (engine) + barcode bands (OrgDefaults) ─────────────
    // Merge preserves locally-edited sticky Sale-Price fields and any locally
    // added rows (negative ids) across a reload (e.g. after a cost-method change).
    const loadData = useCallback(() => Promise.all([
        axios.get<PricingItem[]>("/api/pricing-strategy/items?withSaleAge=1"),
        axios.get<{ barcodeBandsJson?: BarcodeBand[] }>("/api/settings/org-defaults"),
    ]).then(([itemsRes, odRes]) => {
            setBarcodeBands(Array.isArray(odRes.data.barcodeBandsJson) ? odRes.data.barcodeBandsJson : []);
            const mapped = itemsRes.data.map(itemToRow);
            setRows((prev) => {
                const byId = new Map(prev.map((r) => [r.id, r]));
                const merged = mapped.map((m) => {
                    const old = byId.get(m.id);
                    return old
                        ? { ...m, salePrice: old.salePrice, baseline: old.baseline, saleSource: old.saleSource, baseSource: old.baseSource, savedAt: old.savedAt, savedProfit: old.savedProfit }
                        : m;
                });
                const locals = prev.filter((r) => r.id < 0); // keep locally-added rows
                return [...merged, ...locals];
            });
        })
        .catch(() => { toast.error("Failed to load products."); })
        .finally(() => setLoading(false)), []);
    useEffect(() => { loadData(); }, [loadData]);

    // Product rows, brands and categories behind the label picker are catalogue
    // data; a new SKU should be printable without reloading the screen.
    useRealtimeTopics(["catalogue", "stock"], () => { loadData(); });

    // Persist an editable field to InvProduct via the items PATCH. Local-only
    // rows (negative ids) are skipped. `reload` re-pulls the engine values when a
    // change alters the cost basis (cost method) so derived voices stay accurate.
    const persist = useCallback(async (
        id: number,
        patch: { marginPercent?: number | null; mrpPaise?: number | null; costMethod?: string },
        opts?: { reload?: boolean },
    ) => {
        if (id < 0) return;
        try {
            await axios.patch(`/api/pricing-strategy/items/${id}`, patch);
            if (opts?.reload) await loadData();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error : null;
            toast.error(msg ?? "Failed to save change.");
        }
    }, [loadData]);

    // The label queue lives in a module-level store, so the products picked here
    // are the SAME list the standalone Print labels page shows (and the other way
    // round). See src/store/labelPrintStore.ts.
    const queueIds = useLabelPrintStore((s) => s.ids);
    const queueAdd = useLabelPrintStore((s) => s.add);
    const queueRemove = useLabelPrintStore((s) => s.remove);
    const queueClear = useLabelPrintStore((s) => s.clear);
    const queueMarkTouched = useLabelPrintStore((s) => s.markTouched);
    const selectionIds = useMemo(() => new Set(queueIds), [queueIds]);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [fBrand, setFBrand] = useState("ALL");
    const [fCategory, setFCategory] = useState("ALL");
    const [fGroup, setFGroup] = useState("ALL");
    const [fMethod, setFMethod] = useState("ALL");
    const [fSource, setFSource] = useState("ALL");
    const [fBarcodeCapped, setFBarcodeCapped] = useState(false);
    const [fSaleCapped, setFSaleCapped] = useState(false);
    const [fInStock, setFInStock] = useState(false);
    // Threshold boxes: show rows where the metric exceeds x%.
    const [tBarcodeShrink, setTBarcodeShrink] = useState("");
    const [tProfitReduce, setTProfitReduceRaw] = useState("");
    const [tProfitIncrease, setTProfitIncreaseRaw] = useState("");
    // Profit reduced & increased contradict → typing in one empties the other.
    const setTProfitReduce = (val: string) => { setTProfitReduceRaw(val); if (val.trim()) setTProfitIncreaseRaw(""); };
    const setTProfitIncrease = (val: string) => { setTProfitIncreaseRaw(val); if (val.trim()) setTProfitReduceRaw(""); };
    const emptyRanges = (): Record<RangeKey, { min: string; max: string }> =>
        RANGE_FIELDS.reduce((a, f) => { a[f.key] = { min: "", max: "" }; return a; }, {} as Record<RangeKey, { min: string; max: string }>);
    const [ranges, setRanges] = useState<Record<RangeKey, { min: string; max: string }>>(emptyRanges);
    const setRange = (key: RangeKey, side: "min" | "max", val: string) =>
        setRanges((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { min: "", max: "" }), [side]: val } }));
    // "none" = the server's own order; a third click (or "clear sort") comes back to it.
    const sortProps = useTableSort<SortKey | "none">("none", "asc");
    const { sortKey, sortDir, isDefaultSort, resetSort } = sortProps;

    // ── Saved filters (localStorage) ──────────────────────────────────────────
    // Hydrate once on mount (after SSR, so no hydration mismatch), then persist on
    // every change. `hydrated` batches with the restored setStates, so the persist
    // effect never fires with default values before the restore lands.
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(FILTER_STORAGE_KEY);
            if (raw) {
                const s = JSON.parse(raw) as Record<string, unknown>;
                // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the saved filters from localStorage once after mount (the server render has none); `hydrated` holds the persist effect back until it lands
                if (typeof s.query === "string") setQuery(s.query);
                if (typeof s.fBrand === "string") setFBrand(s.fBrand);
                if (typeof s.fCategory === "string") setFCategory(s.fCategory);
                if (typeof s.fGroup === "string") setFGroup(s.fGroup);
                if (typeof s.fMethod === "string") setFMethod(s.fMethod);
                if (typeof s.fSource === "string") setFSource(s.fSource);
                if (typeof s.fBarcodeCapped === "boolean") setFBarcodeCapped(s.fBarcodeCapped);
                if (typeof s.fSaleCapped === "boolean") setFSaleCapped(s.fSaleCapped);
                if (typeof s.fInStock === "boolean") setFInStock(s.fInStock);
                if (typeof s.tBarcodeShrink === "string") setTBarcodeShrink(s.tBarcodeShrink);
                if (typeof s.tProfitReduce === "string") setTProfitReduceRaw(s.tProfitReduce);
                if (typeof s.tProfitIncrease === "string") setTProfitIncreaseRaw(s.tProfitIncrease);
                if (typeof s.filtersOpen === "boolean") setFiltersOpen(s.filtersOpen);
                if (s.ranges && typeof s.ranges === "object") {
                    setRanges({ ...emptyRanges(), ...(s.ranges as Record<RangeKey, { min: string; max: string }>) });
                }
            }
        } catch { /* corrupt blob → ignore, fall back to defaults */ }
        setHydrated(true);
        // run once

    }, []);
    useEffect(() => {
        if (!hydrated) return;
        try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
                query, fBrand, fCategory, fGroup, fMethod, fSource,
                fBarcodeCapped, fSaleCapped, fInStock,
                tBarcodeShrink, tProfitReduce, tProfitIncrease, ranges, filtersOpen,
            }));
        } catch { /* quota / disabled storage → silently skip */ }
    }, [hydrated, query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, tBarcodeShrink, tProfitReduce, tProfitIncrease, ranges, filtersOpen]);

    // Dynamic filter options — distinct values present in the data.
    const distinct = useCallback((pick: (r: Row) => string) =>
        [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
    const brands = useMemo(() => distinct((r) => r.brand), [distinct]);
    const categories = useMemo(() => distinct((r) => r.category), [distinct]);
    const groups = useMemo(() => distinct((r) => r.group), [distinct]);
    const methodOpts = useMemo(
        () => distinct((r) => r.method).map((code) => ({ value: code, label: COST_METHODS.find((m) => m.code === code)?.full ?? code })),
        [distinct],
    );
    const [selected, setSelected] = useState<Set<number>>(new Set());
    // Brand / Category / Group hidden by default — taxonomy noise; show via Columns.
    const [hidden, setHidden] = useState<Set<ColKey>>(new Set<ColKey>(["brand", "category", "group"]));
    const show = (k: ColKey) => !hidden.has(k);
    const toggleCol = (k: ColKey) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    // Always-on columns: select, #, name, remove (4) + the visible toggleable ones.
    const colSpan = 4 + COLS.filter((c) => show(c.key)).length;

    // Filter (by name) + sort → the visible list.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        let v = rows;
        if (q) v = v.filter((r) => productMatchesSearch(r, q));
        if (fBrand !== "ALL") v = v.filter((r) => r.brand === fBrand);
        if (fCategory !== "ALL") v = v.filter((r) => r.category === fCategory);
        if (fGroup !== "ALL") v = v.filter((r) => r.group === fGroup);
        if (fMethod !== "ALL") v = v.filter((r) => r.method === fMethod);
        if (fSource !== "ALL") v = v.filter((r) => r.saleSource === fSource);
        if (fBarcodeCapped) v = v.filter((r) => barcodeCapped(r));
        if (fSaleCapped) v = v.filter((r) => saleCapped(r));
        if (fInStock) v = v.filter((r) => stockQty(r) > 0);
        const xShrink = numOrNull(tBarcodeShrink);
        if (xShrink != null) v = v.filter((r) => { const s = barcodeShrinkPct(r); return s != null && s > xShrink; });
        const xReduce = numOrNull(tProfitReduce);
        if (xReduce != null) v = v.filter((r) => { const g = profitGapPct(r); return g != null && g < -xReduce; });
        const xInc = numOrNull(tProfitIncrease);
        if (xInc != null) v = v.filter((r) => { const g = profitGapPct(r); return g != null && g > xInc; });
        for (const f of RANGE_FIELDS) {
            const cell = ranges[f.key] ?? { min: "", max: "" };
            const lo = numOrNull(cell.min);
            const hi = numOrNull(cell.max);
            if (lo == null && hi == null) continue;
            v = v.filter((r) => {
                if (f.key === "margin") {
                    // Match if EITHER the strategy margin or the user margin is in range.
                    return inRange(numOrNull(r.strategyMargin), lo, hi) || inRange(numOrNull(r.margin), lo, hi);
                }
                return inRange(rangeVal(r, f.key), lo, hi);
            });
        }
        if (sortKey !== "none") {
            const key = sortKey;
            const dir = sortDir === "asc" ? 1 : -1;
            v = [...v].sort((a, b) => {
                const av = sortVal(a, key);
                const bv = sortVal(b, key);
                const c = typeof av === "string" && typeof bv === "string"
                    ? av.localeCompare(bv)
                    // Equal first: two blanks are both -Infinity, and -Infinity - -Infinity is NaN.
                    : av === bv ? 0 : (av as number) - (bv as number);
                return c * dir;
            });
        }
        return v;
    }, [rows, query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, tBarcodeShrink, tProfitReduce, tProfitIncrease, ranges, sortKey, sortDir]);

    // Jump back to the first page whenever the filtered/sorted list or page size
    // changes, so you never land on a now-empty page.
    // While rendering, keyed on the values themselves (ranges / sort by content).
    if (useValueChange(JSON.stringify([query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, tBarcodeShrink, tProfitReduce, tProfitIncrease, ranges, sortKey, sortDir, tab, pageSize]))) {
        setPageIndex(0);
    }

    // The Selected tab shows only the picked rows (still honouring the same filters/sort).
    const selectionRows = useMemo(() => visible.filter((r) => selectionIds.has(r.id)), [visible, selectionIds]);
    // The list the active tab actually renders. (Only the active tab's body mounts.)
    const listRows = tab === "selected" ? selectionRows : visible;
    // Paginate the rendered rows so the full catalogue stays responsive — the page
    // slice keeps the DOM small even when thousands match. pageSize 0 = show All.
    const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(listRows.length / pageSize));
    const safePage = Math.min(pageIndex, totalPages - 1);
    const pageStart = pageSize === 0 ? 0 : safePage * pageSize;
    const pageRows = pageSize === 0 ? listRows : listRows.slice(pageStart, pageStart + pageSize);

    const toggleSel = useCallback((id: number) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        }), []);
    const allSelected = listRows.length > 0 && listRows.every((r) => selected.has(r.id));
    const toggleAll = () =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (allSelected) listRows.forEach((r) => next.delete(r.id));
            else listRows.forEach((r) => next.add(r.id));
            return next;
        });

    // Push the ticked rows into the selection (feeds the Selected product tab), then clear ticks.
    const addToSelection = () => {
        queueAdd([...selected]);
        setSelected(new Set());
    };
    const update = useCallback((id: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);
    // The row's trash button means different things on the two tabs. On Selected it
    // takes the product OUT of the print queue (it stays in the catalogue — that is
    // the only way to un-pick a product, since ticking is one-way). On All products
    // it drops the row from this working list as before.
    const remove = useCallback((id: number) => {
        if (tab === "selected") { queueRemove(id); return; }
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSelected((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, [tab, queueRemove]);
    // Freeze = persist the sticky Sale Price for CHECKED rows via the sale-price
    // endpoint, then reflect the freeze locally (baseline + date + decided profit).
    // SAVED rows store savedSalePricePaise; STRATEGY/COMPUTED rows clear it (follow
    // the live engine). Local-only rows (negative ids) freeze in the UI only.
    const [freezing, setFreezing] = useState(false);
    // A row is a save target if it's ticked OR has an unsaved freeze decision
    // (Sale Price edited or selling source switched). This lets a plain edit/source
    // click activate the Save button without needing a checkbox.
    const isSaveTarget = (r: Row) => selected.has(r.id) || rowDirty(r);
    const save = async () => {
        const today = todayISO();
        const checked = rows.filter(isSaveTarget);

        // Pattern C — this is the largest write on the screen and it used to go
        // through on one click. `checked` is every ticked OR edited row in the
        // WHOLE FILTERED LIST, not just the visible page, and the header checkbox
        // ticks all of them — so a stray click followed by Save could re-freeze
        // the sale price of thousands of products shop-wide. The count is the
        // whole point of the question, so it goes in the button too.
        const writes = checked.filter((r) => r.id > 0).length;
        if (writes > 0) {
            const ok = await confirmAction({
                title: writes === 1 ? "Freeze the barcode price for 1 product?" : `Freeze the barcode price for ${writes} products?`,
                body: "The price shown on each row becomes the saved barcode price, which POS and the shop will charge from. Rows set to Strategy or Computed go back to following the live engine. This cannot be undone in one step.",
                confirmLabel: writes === 1 ? "Freeze 1 price" : `Freeze ${writes} prices`,
            });
            if (!ok) return;
        }

        // Rows whose printed tag actually moves — every piece of that stock needs a
        // fresh label, so their copies default to the full stock qty (see defaultCopies).
        const repriced = checked.filter(rowDirty).map((r) => r.id);
        const payload = checked
            .filter((r) => r.id > 0)
            .map((r) => {
                const sp = numOrNull(r.salePrice);
                // The saved Sale Price (barcode tag) persists whenever one is
                // entered, regardless of which voice sells; a blank input clears it.
                const hasSaved = sp != null;
                const decided = hasSaved ? profitOf(sp, r.costIncl, r.gst)?.amt ?? null : null;
                return {
                    id: r.id,
                    effectiveSalePriceSource: voiceToDb(r.saleSource),
                    savedSalePricePaise: hasSaved ? Math.round(sp * 100) : null,
                    savedProfitPaise: decided != null ? Math.round(decided * 100) : null,
                };
            });
        setFreezing(true);
        try {
            if (payload.length) {
                await axios.put("/api/pricing-strategy/sale-price", { items: payload });
            }
            setRows((prev) =>
                prev.map((r) => {
                    if (!isSaveTarget(r)) return r;
                    const sp = numOrNull(r.salePrice);
                    const hasSaved = sp != null;
                    const decided = hasSaved ? profitOf(sp, r.costIncl, r.gst)?.amt ?? null : null;
                    return {
                        ...r,
                        baseline: r.salePrice,
                        baseSource: r.saleSource,
                        savedAt: hasSaved ? today : "",
                        savedProfit: decided != null ? decided.toFixed(2) : "",
                    };
                }),
            );
            setSelected(new Set());
            if (repriced.length) queueMarkTouched(repriced);
            toast.success(`Frozen — ${payload.length} sale price${payload.length === 1 ? "" : "s"} saved.`);
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error : null;
            toast.error(msg ?? "Failed to save sale prices.");
        } finally {
            setFreezing(false);
        }
    };

    const dirtyCount = rows.filter(rowDirty).length;
    // Rows that the Save action will write: ticked OR edited. Drives the button's
    // enabled state + count, so a plain Sale Price edit activates Save on its own.
    const saveCount = rows.filter(isSaveTarget).length;


    // Plain render fns (not components) so they don't remount on each keystroke.
    const filterSelect = (value: string, onChange: (v: string) => void, allLabel: string, options: { value: string; label: string }[]) => (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="ALL">{allLabel}</SelectItem>
                {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
        </Select>
    );
    const labelled = (label: string, node: ReactNode) => (
        <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
            {node}
        </div>
    );
    const rangeInput = (label: string, key: RangeKey) => (
        <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
            <div className="flex items-center gap-1">
                <Input inputMode="decimal" value={ranges[key]?.min ?? ""} onChange={(e) => setRange(key, "min", e.target.value)} placeholder="min" className="h-7 w-full text-right text-xs font-mono" />
                <span className="text-xs text-muted-foreground">–</span>
                <Input inputMode="decimal" value={ranges[key]?.max ?? ""} onChange={(e) => setRange(key, "max", e.target.value)} placeholder="max" className="h-7 w-full text-right text-xs font-mono" />
            </div>
        </div>
    );
    // Single "more than x%" threshold box.
    const thresholdInput = (label: string, value: string, onChange: (v: string) => void) => (
        <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
            <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">&gt;</span>
                <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="any" className="h-7 w-20 text-right text-xs font-mono" />
                <span className="text-xs text-muted-foreground">%</span>
            </div>
        </div>
    );

    const catActive = [fBrand, fCategory, fGroup, fMethod, fSource].filter((x) => x !== "ALL").length;
    const flagActive = [fBarcodeCapped, fSaleCapped, fInStock].filter(Boolean).length;
    const thrActive = [tBarcodeShrink, tProfitReduce, tProfitIncrease].filter((x) => x.trim()).length;
    const rangeActive = RANGE_FIELDS.filter((f) => ranges[f.key]?.min.trim() || ranges[f.key]?.max.trim()).length;
    const activeFilterCount = catActive + flagActive + thrActive + rangeActive;
    const clearAllFilters = () => {
        setFBrand("ALL"); setFCategory("ALL"); setFGroup("ALL"); setFMethod("ALL"); setFSource("ALL");
        setFBarcodeCapped(false); setFSaleCapped(false); setFInStock(false);
        setTBarcodeShrink(""); setTProfitReduceRaw(""); setTProfitIncreaseRaw("");
        setRanges(emptyRanges());
    };

    // Inline tab switcher — lives in the toolbar row (no separate tabs row) so the
    // table gets the extra vertical space.
    const tabSwitcher = (
        <div className="flex shrink-0 items-center rounded-md border bg-muted/40 p-0.5 text-xs font-medium">
            <button
                type="button"
                onClick={() => setTab("all")}
                className={`rounded px-2.5 py-1 transition-colors ${tab === "all" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
                All products
            </button>
            <button
                type="button"
                onClick={() => setTab("selected")}
                className={`rounded px-2.5 py-1 transition-colors ${tab === "selected" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
                Selected{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
            </button>
        </div>
    );

    // The product table body — shared by the "All products" and "Selected product"
    // tabs (same UI for now; "Selected product" will narrow the list later).
    const productBody = (
        <>
            {/* Toolbar: tab switcher + search + filters + the selection/print actions + columns */}
            <div className="mb-3 flex shrink-0 items-center gap-3">
                {tabSwitcher}
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name / SKU…"
                        className="h-8 w-56 pl-7 text-xs"
                    />
                </div>
                <Button type="button" variant={filtersOpen ? "secondary" : "outline"} size="sm" className="h-8" onClick={() => setFiltersOpen((o) => !o)}>
                    <Filter className="size-3.5" /> Filters
                    {activeFilterCount > 0 ? (
                        <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">{activeFilterCount}</span>
                    ) : null}
                </Button>
                <span className="text-xs text-muted-foreground">
                    {tab === "selected" ? `${listRows.length} in selection` : `${listRows.length} / ${rows.length} shown`}
                </span>
                {!isDefaultSort ? (
                    <button type="button" onClick={resetSort} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                        clear sort
                    </button>
                ) : null}
                {/* Selection / print actions — pushed to the right, just before Columns. */}
                <div className="ml-auto flex items-center gap-3">
                    {tab === "all" ? (
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addToSelection} disabled={selected.size === 0}>
                            <Plus className="size-4" /> Add to selection{selected.size > 0 ? ` (${selected.size})` : ""}
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={async () => {
                                    // Pattern C — this empties the print queue that the
                                    // Print labels page shares, so it throws away work
                                    // done on another screen. Worth one question.
                                    const ok = await confirmAction({
                                        title: `Clear all ${selectionIds.size} products from the selection?`,
                                        body: "The print queue is shared with the Print labels page, so it empties there too. The products themselves stay in the catalogue.",
                                        confirmLabel: "Clear selection",
                                    });
                                    if (ok) queueClear();
                                }}
                                disabled={selectionIds.size === 0}
                                title="Empty the whole selection (the products stay in the catalogue)"
                            >
                                Clear selection
                            </Button>
                            {canOpen("/office/pricing-strategy/print-labels") && (
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => router.push("/office/pricing-strategy/print-labels")} title="Open Print labels — the same products laid out as labels (you can add more there)">
                                    <Printer className="size-4" /> Go to Print{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
                                </Button>
                            )}
                        </>
                    )}
                    <span className="text-xs text-muted-foreground">
                        {selected.size > 0
                            ? `${selected.size} ticked`
                            : dirtyCount === 0 ? "Barcodes current" : `${dirtyCount} to update`}
                    </span>
                    <Button type="button" size="sm" className="h-8" onClick={save} disabled={saveCount === 0 || freezing} title="Save the barcode price for ticked or edited rows. SAVED rows store the sticky price (POS + shop use it); Strategy/Computed rows follow the live engine. Margin %, MRP and Method save automatically as you edit.">
                        {freezing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save barcode Price{saveCount > 0 ? ` (${saveCount})` : ""}
                    </Button>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-8">
                            <SlidersHorizontal className="size-3.5" /> Columns
                            {hidden.size > 0 ? <span className="ml-1 text-[10px] text-muted-foreground">({COLS.length - hidden.size}/{COLS.length})</span> : null}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {COLS.map((c) => (
                            <DropdownMenuCheckboxItem
                                key={c.key}
                                checked={show(c.key)}
                                onCheckedChange={() => toggleCol(c.key)}
                                onSelect={(e) => e.preventDefault()}
                                className="text-xs"
                            >
                                {c.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Collapsible filter card — categorical + numeric ranges */}
            {filtersOpen ? (
                <div className="mb-3 shrink-0 rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        {/* <span className="text-xs font-medium">Filters — all parameters &amp; ranges</span> */}
                        {activeFilterCount > 0 ? (
                            <button type="button" onClick={clearAllFilters} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                                Clear all ({activeFilterCount})
                            </button>
                        ) : null}
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {labelled("Brand", filterSelect(fBrand, setFBrand, "All", brands.map((b) => ({ value: b, label: b }))))}
                        {labelled("Collection", filterSelect(fCategory, setFCategory, "All", categories.map((c) => ({ value: c, label: c }))))}
                        {labelled("Group", filterSelect(fGroup, setFGroup, "All", groups.map((g) => ({ value: g, label: g }))))}
                        {labelled("Method", filterSelect(fMethod, setFMethod, "All", methodOpts))}
                        {labelled("Sells at", filterSelect(fSource, setFSource, "All", SOURCE_OPTIONS))}
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fBarcodeCapped} onCheckedChange={(v) => setFBarcodeCapped(v === true)} />
                            Barcode capped
                            {/* <span className="text-muted-foreground">(MRP squeezing barcode)</span> */}
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fSaleCapped} onCheckedChange={(v) => setFSaleCapped(v === true)} />
                            Sale price capped
                            {/* <span className="text-muted-foreground">(selling held at ceiling)</span> */}
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fInStock} onCheckedChange={(v) => setFInStock(v === true)} />
                            In stock only
                            {/* <span className="text-muted-foreground">(hide zero stock)</span> */}
                        </label>
                        {/* </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"> */}
                        {thresholdInput("Barcode gap shrunk", tBarcodeShrink, setTBarcodeShrink)}
                        {thresholdInput("Profit reduced", tProfitReduce, setTProfitReduce)}
                        {thresholdInput("Profit increased", tProfitIncrease, setTProfitIncrease)}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {RANGE_FIELDS.map((f) => <div key={f.key}>{rangeInput(f.label, f.key)}</div>)}
                    </div>
                </div>
            ) : null}

            {/* Flex-fill scroll box: it takes the leftover vertical space (toolbar +
                filter card are shrink-0 above it) and scrolls BOTH axes itself, so
                ONLY the rows scroll — the page never does. The horizontal scrollbar
                stays pinned at its bottom and the sticky header keeps the column row
                visible while rows scroll under it. */}
            <div className="min-h-0 flex-1 overflow-auto rounded-sm border *:data-[slot=table-container]:overflow-x-visible">
                {/* Compact density: tighter than the default shadcn cell padding so the
                    grid fits more columns and the Product name gets the leftover width. */}
                <Table className="[&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1">
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead className="w-8">
                                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all visible rows" />
                            </TableHead>
                            <TableHead className="w-8 text-xs">#</TableHead>
                            <SortHeader k="name" label="Product name" className={`${SORT_TH} w-full min-w-[240px]`} {...sortProps} />
                            {show("brand") ? <SortHeader k="brand" label="Brand" className={SORT_TH} {...sortProps} /> : null}
                            {show("category") ? <SortHeader k="category" label="Collection" className={SORT_TH} {...sortProps} /> : null}
                            {show("group") ? <SortHeader k="group" label="Group" className={SORT_TH} {...sortProps} /> : null}
                            {show("stock") ? <SortHeader k="stock" label="Stock" align="right" firstDir="desc" className={`${SORT_TH} ${COL_TINT.stock}`} {...sortProps} /> : null}
                            {show("cost") ? <SortHeader k="cost" label="Cost (incl)" align="right" firstDir="desc" className={`${SORT_TH} ${COL_TINT.cost}`} {...sortProps} /> : null}
                            {show("margin") ? <TableHead className={`text-right text-xs ${COL_TINT.margin}`}>Margin %</TableHead> : null}
                            {show("computed") ? <SortHeader k="computed" label="Computed" align="right" firstDir="desc" className={`${SORT_TH} ${COL_TINT.computed}`} {...sortProps} /> : null}
                            {show("strategy") ? <SortHeader k="strategy" label="Strategy" align="right" firstDir="desc" title="Go to Strategy page to change" className={`${SORT_TH} ${COL_TINT.strategy}`} {...sortProps} /> : null}
                            {show("sale") ? <SortHeader k="saved" label="Sale Price" align="right" firstDir="desc" title="Manual — you type this price" className={`${SORT_TH} ${COL_TINT.sale}`} {...sortProps} /> : null}
                            {show("selling") ? <TableHead className={`text-right text-xs ${COL_TINT.selling}`}>Selling</TableHead> : null}
                            {show("mrp") ? <TableHead className={`text-right text-xs ${COL_TINT.mrp}`}>MRP</TableHead> : null}
                            {show("barcode") ? <SortHeader k="barcode" label="Barcode" align="right" firstDir="desc" title="Edit Sale Price to change" className={`${SORT_TH} ${COL_TINT.barcode}`} {...sortProps} /> : null}
                            <TableHead className="w-8" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {listRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
                                    {loading ? (
                                        <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading products…</span>
                                    ) : tab === "selected"
                                        ? "No products in selection — tick rows in All products and click Add to selection."
                                        : `No products match “${query}”.`}
                                </TableCell>
                            </TableRow>
                        ) : null}
                        {pageRows.map((r, i) => (
                            <ProductRow
                                key={r.id}
                                r={r}
                                index={pageStart + i}
                                hidden={hidden}
                                selected={selected.has(r.id)}
                                onUpdate={update}
                                onPersist={persist}
                                onToggleSel={toggleSel}
                                onRemove={remove}
                                removeTitle={tab === "selected" ? "Remove from selection" : "Remove from this list"}
                            />
                        ))}
                    </TableBody>
                </Table>
            </div>
            {/* Pager — fixed below the scrolling rows; reaches the whole catalogue. */}
            <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                    {listRows.length === 0
                        ? "No rows"
                        : pageSize === 0
                            ? `Showing all ${listRows.length}`
                            : `${pageStart + 1}–${Math.min(pageStart + pageSize, listRows.length)} of ${listRows.length}`}
                </span>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Page size
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                            <option value={50}>50</option>
                            <option value={150}>150</option>
                            <option value={300}>300</option>
                            <option value={0}>All</option>
                        </select>
                    </label>
                    {pageSize !== 0 && totalPages > 1 ? (
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage === 0} onClick={() => setPageIndex(0)}>«</Button>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage === 0} onClick={() => setPageIndex(safePage - 1)}>‹</Button>
                            <span className="px-2 text-xs text-muted-foreground">{safePage + 1} / {totalPages}</span>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(safePage + 1)}>›</Button>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(totalPages - 1)}>»</Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </>
    );

    // This page is the PRICING half of the label job — the table, and nothing else.
    // Laying the labels out and printing them lives on its own page (Pricing
    // Strategy → Print labels), working off the same shared queue.
    return (
        <div className="flex h-full flex-col overflow-hidden px-4 pt-3 pb-3">
            <div className="flex min-h-0 flex-1 flex-col">{productBody}</div>
        </div>
    );
}
