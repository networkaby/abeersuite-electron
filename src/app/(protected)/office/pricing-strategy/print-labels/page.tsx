"use client";

/**
 * GENERATE page (UI only) — prototype of the price-generation step that feeds
 * the barcode labels. Nothing here is fetched or saved yet; it's a sandbox to
 * agree the columns + behaviour before wiring it to real data.
 *
 * A product has THREE price "voices":
 *   • Strategy — the winning pricing-strategy rule's output. LIVE (floats with cost).
 *   • Computed — cost × my margin. LIVE (floats with cost).
 *   • Sale Price — the sticky, human-frozen price. Changes only when you Save.
 *
 * You pick which voice actually sells by CLICKING it — the highlighted one is the
 * selling price. POS makes no decision; it just charges that voice, capped by the
 * barcode price and MRP (cap not shown as its own column — see Barcode).
 *
 * The barcode price is computed from the Sale Price (buffer band + hint digit,
 * MRP-capped) and acts as a CEILING — never the charge. Each voice shows its own
 * AFTER-TAX profit (₹ + %) beneath the price, so all three can be compared.
 *
 * For the real ~3000-product list: a name filter + sortable headers. The barcode
 * carries a secret date code (MM + ten-day third) so staff can read how old a
 * printed price is.
 *
 *   voicePrice = (cost_incl + charges) × (1 + margin% / 100)
 */

import { type ReactNode, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelDesigner, type Item as LabelItem, type AddedProduct } from "@/modules/inventory/components/LabelDesigner";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronDown, ChevronsUpDown, ChevronUp, Filter, Plus, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react";

// ── Cost methods (short code ↔ real CostMethod enum, for later wiring) ────────

type CostCode = "WA" | "FO" | "SA" | "MA" | "LI";
const COST_METHODS: { code: CostCode; full: string; enum: string }[] = [
    { code: "WA", full: "Weighted Avg", enum: "WEIGHTED_AVG" },
    { code: "FO", full: "FIFO",         enum: "FIFO" },
    { code: "SA", full: "Simple Avg",   enum: "SIMPLE_AVG" },
    { code: "MA", full: "Monthly Avg",  enum: "MONTHLY_AVG" },
    { code: "LI", full: "Last Inward",  enum: "LAST_INWARD" },
];

// ── Toggleable columns (show/hide) ───────────────────────────────────────────
// Name / # / select / remove are always shown; everything else can be hidden.
type ColKey = "brand" | "category" | "group" | "stock" | "method" | "cost" | "charges" | "margin" | "strategy" | "computed" | "sale" | "mrp" | "barcode";
const COLS: { key: ColKey; label: string }[] = [
    { key: "brand",    label: "Brand" },
    { key: "category", label: "Category" },
    { key: "group",    label: "Group" },
    { key: "stock",    label: "Stock" },
    { key: "method",   label: "Method" },
    { key: "cost",     label: "Cost (incl)" },
    { key: "charges",  label: "Charges ₹" },
    { key: "margin",   label: "Margin %" },
    { key: "strategy", label: "Strategy" },
    { key: "computed", label: "Computed" },
    { key: "sale",     label: "Sale Price" },
    { key: "mrp",      label: "MRP" },
    { key: "barcode",  label: "Barcode (cap)" },
];

// ── Row data (UI only) ───────────────────────────────────────────────────────

type SaleSource = "STRATEGY" | "MY" | "SAVED";

type Row = {
    id: number;
    name: string;
    barcode: string;        // scannable EAN/SKU printed on the label (feeds the Print tab)
    brand: string;          // taxonomy — for the Brand filter (mirrors InvProduct.brand)
    category: string;       // taxonomy — for the Category filter
    group: string;          // taxonomy — for the Group filter
    stock: string;          // current stock (qty) — for the "in stock only" filter
    method: CostCode;
    costIncl: string;       // ₹ incl GST, typed
    gst: string;            // GST %, typed
    margin: string;         // % — drives the "Computed" voice
    strategyMargin: string; // % — drives the mock "Strategy" voice (stand-in for the engine)
    charges: string;        // other ₹ charges added onto cost (freight, handling…)
    salePrice: string;      // Sale Price (sticky), user-editable; "" = not set
    baseline: string;       // last-saved Sale Price, for dirty detection
    mrp: string;            // MRP ceiling (incl GST). "" = no MRP
    saleSource: SaleSource; // which voice actually sells
    savedAt: string;        // ISO date the Sale Price was last frozen → barcode date code
    savedProfit: string;    // decided profit ₹ frozen at last save → basis for the profit-gap filter
};

const SAMPLE: Row[] = [
    // savedProfit = profit decided when last printed; current cost edits make it drift (shrinking/over).
    { id: 1, name: "360 Wifi Camera CP PLUS E24A-2MP", barcode: "4250593440769", brand: "CP Plus", category: "Camera",  group: "CCTV",        stock: "12", method: "WA", costIncl: "992",  gst: "18", margin: "25", strategyMargin: "35", charges: "0", salePrice: "1240", baseline: "1240", mrp: "1400", saleSource: "SAVED",    savedAt: "2026-05-14", savedProfit: "250" },
    { id: 2, name: "360 Wifi Camera CP PLUS E35A-3MP", barcode: "4250593443319", brand: "CP Plus", category: "Camera",  group: "CCTV",        stock: "0",  method: "WA", costIncl: "1349", gst: "18", margin: "25", strategyMargin: "30", charges: "0", salePrice: "1650", baseline: "1650", mrp: "1700", saleSource: "STRATEGY", savedAt: "2026-05-03", savedProfit: "200" },
    { id: 3, name: "Adapter 19v 40w 2.1mp",            barcode: "38686599387",   brand: "Generic", category: "Adapter", group: "Spare Parts", stock: "5",  method: "LI", costIncl: "400",  gst: "18", margin: "30", strategyMargin: "20", charges: "0", salePrice: "",     baseline: "",     mrp: "600",  saleSource: "MY",       savedAt: "",           savedProfit: "" },
    { id: 4, name: "30Pin Lvds Cable Universal Board",  barcode: "38692809948",   brand: "Generic", category: "Cable",   group: "Spare Parts", stock: "0",  method: "WA", costIncl: "229",  gst: "18", margin: "20", strategyMargin: "28", charges: "0", salePrice: "260",  baseline: "260",  mrp: "300",  saleSource: "SAVED",    savedAt: "2026-05-28", savedProfit: "26.27" },
];

// ── Compute ──────────────────────────────────────────────────────────────────

// A voice price = (cost + charges) × (1 + margin/100). Used for both Strategy
// (strategyMargin) and Computed (margin). Exact value; rounding at voucher time.
function priceWithMargin(costIncl: string, charges: string, marginStr: string): number | null {
    const cost = parseFloat(costIncl);
    if (!isFinite(cost) || cost < 0) return null;
    const ch = parseFloat(charges);
    const base = cost + (isFinite(ch) ? ch : 0);
    const m = parseFloat(marginStr);
    return base * (1 + (isFinite(m) ? m : 0) / 100);
}

// After-tax profit on a given selling price: strip GST from both sale and the
// charged-up cost (output GST owed, input GST reclaimed). pct = margin on net sale.
function profitOf(
    price: number | null,
    costIncl: string,
    charges: string,
    gstStr: string,
): { amt: number; pct: number | null } | null {
    if (price == null) return null;
    const cost = parseFloat(costIncl);
    if (!isFinite(cost)) return null;
    const ch = parseFloat(charges);
    const chg = isFinite(ch) ? ch : 0;
    const gst = parseFloat(gstStr);
    const gstMul = isFinite(gst) && gst > 0 ? 1 + gst / 100 : 1;
    const netSale = price / gstMul;
    const netCost = (cost + chg) / gstMul;
    const amt = netSale - netCost;
    const pct = netSale > 0 ? (amt / netSale) * 100 : null;
    return { amt, pct };
}

const rupee = (n: number | null) => (n == null ? "—" : `₹${n.toFixed(2)}`);

// Secret barcode date code: year omitted, MM + ten-day third (1 = days 1–10,
// 2 = 11–20, 3 = 21–end). e.g. 2026-05-14 → "052". Lets staff gauge how old a
// printed price is without showing customers a plain date.
function secretDateCode(iso: string): string {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const day = d.getDate();
    const third = day <= 10 ? 1 : day <= 20 ? 2 : 3;
    return `${mm}${third}`;
}

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Barcode price (the headroom price printed on the label) ───────────────────
//
// A band-based buffer is added to the Sale Price to leave room on the printed
// barcode. The buffered value is rounded to the nearest 10, then a "hint" digit
// (from the band) is set as the units digit — silently telling staff which band
// applied. Fallback: no band → barcode = sale price. MRP cap: when MRP is tight,
// the barcode floors to MRP (trailing 0 = capped); if even that drops below the
// sale price, print MRP exactly (token "m" → underlined). Bands will live on
// OrgDefaults (JSON); hardcoded here for now as the seed default.

const BARCODE_BANDS: { max: number; add: number; hint: number }[] = [
    { max: 50,    add: 10,  hint: 1 },
    { max: 100,   add: 20,  hint: 2 },
    { max: 300,   add: 30,  hint: 3 },
    { max: 500,   add: 50,  hint: 5 },
    { max: 2000,  add: 100, hint: 6 },
    { max: 5000,  add: 150, hint: 7 },
    { max: 10000, add: 200, hint: 8 },
    { max: 99999, add: 500, hint: 9 },
];

function barcodePrice(
    price: number | null,
    mrp: number | null = null,
): { value: number | null; hint: string; capped: boolean } {
    if (price == null || !isFinite(price) || price < 1) return { value: null, hint: "", capped: false };
    const band = BARCODE_BANDS.find((b) => price <= b.max);
    let value = band ? Math.round((price + band.add) / 10) * 10 + band.hint : Math.round(price);
    let hint = band ? String(band.hint) : "";
    let capped = false;
    if (mrp != null && mrp > 0 && value > mrp) {
        const floored = Math.floor(mrp / 10) * 10;
        if (floored >= price) {
            value = floored;
            hint = "0";
        } else {
            value = mrp;
            hint = "m";
        }
        capped = true;
    }
    return { value, hint, capped };
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "name" | "brand" | "category" | "group" | "stock" | "cost" | "strategy" | "computed" | "saved" | "barcode";

function sortVal(r: Row, key: SortKey): number | string {
    switch (key) {
        case "name": return r.name.toLowerCase();
        case "brand": return r.brand.toLowerCase();
        case "category": return r.category.toLowerCase();
        case "group": return r.group.toLowerCase();
        case "stock": { const v = parseFloat(r.stock); return isFinite(v) ? v : -Infinity; }
        case "cost": { const v = parseFloat(r.costIncl); return isFinite(v) ? v : -Infinity; }
        case "strategy": return priceWithMargin(r.costIncl, r.charges, r.strategyMargin) ?? -Infinity;
        case "computed": return priceWithMargin(r.costIncl, r.charges, r.margin) ?? -Infinity;
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

type RangeKey = "cost" | "margin" | "profit" | "profitPct";
const RANGE_FIELDS: { key: RangeKey; label: string }[] = [
    { key: "cost",      label: "Cost (incl)" },
    { key: "margin",    label: "Margin % (strategy & mine)" },
    { key: "profit",    label: "Profit ₹ (sale price)" },
    { key: "profitPct", label: "Profit % (sale price)" },
];

const SOURCE_OPTIONS = [
    { value: "STRATEGY", label: "Strategy" },
    { value: "MY",       label: "Computed" },
    { value: "SAVED",    label: "Sale Price" },
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
        r.saleSource === "STRATEGY" ? priceWithMargin(r.costIncl, r.charges, r.strategyMargin)
        : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.charges, r.margin)
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
        r.saleSource === "STRATEGY" ? priceWithMargin(r.costIncl, r.charges, r.strategyMargin)
        : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.charges, r.margin)
        : saved;
    if (chosen == null) return false;
    const applic = applicableSalePrice(r);
    return applic != null && applic < chosen - 0.005;
}

const stockQty = (r: Row): number => numOrNull(r.stock) ?? 0;

// The numeric value of a row for a given range parameter. The Margin range is
// special-cased in the filter loop (it checks BOTH strategy & user margin).
function rangeVal(r: Row, key: RangeKey): number | null {
    switch (key) {
        case "cost": return numOrNull(r.costIncl);
        case "margin": return numOrNull(r.margin);
        case "profit": {
            // After-tax profit on the price that actually applies (capped selling voice).
            const price = applicableSalePrice(r);
            if (price == null) return null;
            return profitOf(price, r.costIncl, r.charges, r.gst)?.amt ?? null;
        }
        case "profitPct": {
            const price = applicableSalePrice(r);
            if (price == null) return null;
            return profitOf(price, r.costIncl, r.charges, r.gst)?.pct ?? null;
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
        r.saleSource === "STRATEGY" ? priceWithMargin(r.costIncl, r.charges, r.strategyMargin)
        : r.saleSource === "MY" ? priceWithMargin(r.costIncl, r.charges, r.margin)
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
    const cur = profitOf(saved, r.costIncl, r.charges, r.gst)?.amt;
    if (cur == null) return null;
    return ((cur - decided) / Math.abs(decided)) * 100;
}

// ── Voice cell (clickable price chip) ─────────────────────────────────────────

function voiceClass(selected: boolean): string {
    return `w-full rounded px-1.5 py-1 text-right transition-colors ${
        selected ? "bg-emerald-50 ring-1 ring-emerald-400" : "cursor-pointer hover:bg-muted"
    }`;
}

const SELLING_TAG = (
    <span className="mb-0.5 flex items-center justify-end gap-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-600">
        <Check className="size-2.5" /> selling
    </span>
);

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GeneratePage() {
    const [rows, setRows] = useState<Row[]>(SAMPLE);
    const nextId = useRef(SAMPLE.length + 1);
    const [query, setQuery] = useState("");
    // Active tab + the working "selection" (ids the user pushed into the Selected tab).
    const [tab, setTab] = useState<"all" | "selected" | "print">("all");
    const [selectionIds, setSelectionIds] = useState<Set<number>>(new Set());
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
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

    // Dynamic filter options — distinct values present in the data.
    const distinct = (pick: (r: Row) => string) =>
        [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const brands = useMemo(() => distinct((r) => r.brand), [rows]);
    const categories = useMemo(() => distinct((r) => r.category), [rows]);
    const groups = useMemo(() => distinct((r) => r.group), [rows]);
    const methodOpts = useMemo(
        () => distinct((r) => r.method).map((code) => ({ value: code, label: COST_METHODS.find((m) => m.code === code)?.full ?? code })),
        [rows],
    );
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
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
        if (q) v = v.filter((r) => r.name.toLowerCase().includes(q));
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
        if (sort) {
            const s = sort;
            v = [...v].sort((a, b) => {
                const av = sortVal(a, s.key);
                const bv = sortVal(b, s.key);
                const c = typeof av === "string" && typeof bv === "string"
                    ? av.localeCompare(bv)
                    : (av as number) - (bv as number);
                return c * s.dir;
            });
        }
        return v;
    }, [rows, query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, tBarcodeShrink, tProfitReduce, tProfitIncrease, ranges, sort]);

    // The Selected tab shows only the picked rows (still honouring the same filters/sort).
    const selectionRows = useMemo(() => visible.filter((r) => selectionIds.has(r.id)), [visible, selectionIds]);
    // The list the active tab actually renders. (Only the active tab's body mounts.)
    const listRows = tab === "selected" ? selectionRows : visible;

    // Selected rows → label items for the Print tab. The printed price is the
    // barcode price (the band-buffered cap), falling back to the sale price.
    const printItems = useMemo<LabelItem[]>(() =>
        selectionRows.map((r) => {
            const saved = numOrNull(r.salePrice);
            const m = numOrNull(r.mrp);
            const bc = saved != null ? barcodePrice(saved, m != null && m > 0 ? m : null).value : null;
            const price = bc ?? saved ?? applicableSalePrice(r);
            return {
                id: r.id,
                name: r.name,
                barcode: r.barcode || String(r.id),
                price: price != null ? String(Math.round(price)) : "0",
                mrp: r.mrp || "0",
                date: r.savedAt || todayISO(),
            };
        }), [selectionRows]);

    const toggleSort = (key: SortKey) =>
        setSort((s) => (s && s.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

    const toggleSel = (id: number) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
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
        setSelectionIds((prev) => new Set([...prev, ...selected]));
        setSelected(new Set());
    };
    // Drop the ticked rows from the selection (used in the Selected product tab).
    const removeFromSelection = () => {
        setSelectionIds((prev) => {
            const next = new Set(prev);
            selected.forEach((id) => next.delete(id));
            return next;
        });
        setSelected(new Set());
    };

    // Products added from the Print tab (combobox / voucher) flow back into the
    // shared set: an existing row (by barcode) is just selected; a new product
    // becomes a fresh pricing row and is selected — so it shows in BOTH tabs.
    const addProducts = (products: AddedProduct[]) => {
        const byBarcode = new Map(rows.filter((r) => r.barcode).map((r) => [r.barcode, r]));
        const additions: Row[] = [];
        const selectIds: number[] = [];
        for (const p of products) {
            const existing = p.barcode ? byBarcode.get(p.barcode) : undefined;
            if (existing) { selectIds.push(existing.id); continue; }
            const id = nextId.current++;
            const sale = p.salePrice != null ? String(p.salePrice) : "";
            const row: Row = {
                id, name: p.name, barcode: p.barcode || "", brand: "", category: "", group: "", stock: "0",
                method: "WA", costIncl: p.costPrice != null ? String(p.costPrice) : "0", gst: "18",
                margin: "25", strategyMargin: "30", charges: "0", salePrice: sale, baseline: sale,
                mrp: p.mrp != null ? String(p.mrp) : "", saleSource: "SAVED", savedAt: "", savedProfit: "",
            };
            additions.push(row);
            if (row.barcode) byBarcode.set(row.barcode, row); // dedupe within this batch
            selectIds.push(id);
        }
        if (additions.length) setRows((prev) => [...prev, ...additions]);
        setSelectionIds((prev) => new Set([...prev, ...selectIds]));
    };

    // Removing a label in the Print tab just drops it from the shared selection
    // (the product stays in the All products catalog).
    const removePrintItem = (id: number) =>
        setSelectionIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });

    const update = (id: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const remove = (id: number) => {
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSelected((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };
    const addRow = () =>
        setRows((prev) => [
            ...prev,
            {
                id: nextId.current++, name: "New item", barcode: "", brand: "", category: "", group: "", stock: "0",
                method: "WA", costIncl: "0", gst: "18", margin: "25", strategyMargin: "30",
                charges: "0", salePrice: "", baseline: "", mrp: "", saleSource: "SAVED", savedAt: "", savedProfit: "",
            },
        ]);

    // Save = freeze price + date + the DECIDED PROFIT (profit on the saved price at
    // today's cost) for CHECKED rows, then clear the ticks. Storing the decided
    // profit avoids any historical-cost lookup later — the gap is current vs stored.
    const save = () => {
        const today = todayISO();
        setRows((prev) =>
            prev.map((r) => {
                if (!selected.has(r.id)) return r;
                const sp = numOrNull(r.salePrice);
                if (sp == null) return { ...r, baseline: r.salePrice };
                const decided = profitOf(sp, r.costIncl, r.charges, r.gst)?.amt ?? null;
                return {
                    ...r,
                    baseline: r.salePrice,
                    savedAt: today,
                    savedProfit: decided != null ? decided.toFixed(2) : "",
                };
            }),
        );
        setSelected(new Set());
    };

    const dirtyCount = rows.filter((r) => r.salePrice.trim() !== r.baseline.trim()).length;

    const sortIcon = (k: SortKey) =>
        sort?.key === k
            ? sort.dir === 1 ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
            : <ChevronsUpDown className="size-3 opacity-40" />;

    const SortTh = ({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" }) => (
        <TableHead className={`text-xs ${align === "right" ? "text-right" : ""}`}>
            <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
                {label}{sortIcon(k)}
            </button>
        </TableHead>
    );

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

    // The product table body — shared by the "All products" and "Selected product"
    // tabs (same UI for now; "Selected product" will narrow the list later).
    const productBody = (
        <>
            <div className="mb-3 flex items-center justify-end gap-3">
                {tab === "all" ? (
                    <Button type="button" variant="outline" size="sm" onClick={addToSelection} disabled={selected.size === 0}>
                        <Plus className="size-4" /> Add to selection{selected.size > 0 ? ` (${selected.size})` : ""}
                    </Button>
                ) : (
                    <Button type="button" variant="outline" size="sm" onClick={removeFromSelection} disabled={selected.size === 0}>
                        <Trash2 className="size-4" /> Remove from selection{selected.size > 0 ? ` (${selected.size})` : ""}
                    </Button>
                )}
                <span className="text-xs text-muted-foreground">
                    {selected.size > 0
                        ? `${selected.size} ticked`
                        : dirtyCount === 0 ? "Barcodes current" : `${dirtyCount} to update`}
                </span>
                <Button type="button" size="sm" onClick={save} disabled={selected.size === 0} title="Freeze the sale price and stamp today's date — the printed barcode price + date code">
                    <Save className="size-4" /> Update barcode{selected.size > 0 ? ` (${selected.size})` : ""}
                </Button>
            </div>

            {/* Toolbar: search + filters toggle + columns */}
            <div className="mb-3 flex items-center gap-3">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name…"
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
                {sort ? (
                    <button type="button" onClick={() => setSort(null)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                        clear sort
                    </button>
                ) : null}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="ml-auto h-8">
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
                <div className="mb-3 rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium">Filters — all parameters &amp; ranges</span>
                        {activeFilterCount > 0 ? (
                            <button type="button" onClick={clearAllFilters} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                                Clear all ({activeFilterCount})
                            </button>
                        ) : null}
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {labelled("Brand", filterSelect(fBrand, setFBrand, "All", brands.map((b) => ({ value: b, label: b }))))}
                        {labelled("Category", filterSelect(fCategory, setFCategory, "All", categories.map((c) => ({ value: c, label: c }))))}
                        {labelled("Group", filterSelect(fGroup, setFGroup, "All", groups.map((g) => ({ value: g, label: g }))))}
                        {labelled("Method", filterSelect(fMethod, setFMethod, "All", methodOpts))}
                        {labelled("Sells at", filterSelect(fSource, setFSource, "All", SOURCE_OPTIONS))}
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fBarcodeCapped} onCheckedChange={(v) => setFBarcodeCapped(v === true)} />
                            Barcode capped <span className="text-muted-foreground">(MRP squeezing barcode)</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fSaleCapped} onCheckedChange={(v) => setFSaleCapped(v === true)} />
                            Sale price capped <span className="text-muted-foreground">(selling held at ceiling)</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={fInStock} onCheckedChange={(v) => setFInStock(v === true)} />
                            In stock only <span className="text-muted-foreground">(hide zero stock)</span>
                        </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {thresholdInput("Barcode gap shrunk", tBarcodeShrink, setTBarcodeShrink)}
                        {thresholdInput("Profit reduced", tProfitReduce, setTProfitReduce)}
                        {thresholdInput("Profit increased", tProfitIncrease, setTProfitIncrease)}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {RANGE_FIELDS.map((f) => <div key={f.key}>{rangeInput(f.label, f.key)}</div>)}
                    </div>
                </div>
            ) : null}

            <div className="rounded-sm border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8">
                                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all visible rows" />
                            </TableHead>
                            <TableHead className="w-8 text-xs">#</TableHead>
                            <SortTh label="Product name" k="name" align="left" />
                            {show("brand") ? <SortTh label="Brand" k="brand" align="left" /> : null}
                            {show("category") ? <SortTh label="Category" k="category" align="left" /> : null}
                            {show("group") ? <SortTh label="Group" k="group" align="left" /> : null}
                            {show("stock") ? <SortTh label="Stock" k="stock" /> : null}
                            {show("method") ? <TableHead className="text-xs">Method</TableHead> : null}
                            {show("cost") ? <SortTh label="Cost (incl)" k="cost" /> : null}
                            {show("charges") ? <TableHead className="text-right text-xs">Charges ₹</TableHead> : null}
                            {show("margin") ? <TableHead className="text-right text-xs">Margin %</TableHead> : null}
                            {show("strategy") ? <SortTh label="Strategy" k="strategy" /> : null}
                            {show("computed") ? <SortTh label="Computed" k="computed" /> : null}
                            {show("sale") ? <SortTh label="Sale Price" k="saved" /> : null}
                            {show("mrp") ? <TableHead className="text-right text-xs">MRP</TableHead> : null}
                            {show("barcode") ? <SortTh label="Barcode (cap)" k="barcode" /> : null}
                            <TableHead className="w-8" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {listRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
                                    {tab === "selected"
                                        ? "No products in selection — tick rows in All products and click Add to selection."
                                        : `No products match “${query}”.`}
                                </TableCell>
                            </TableRow>
                        ) : null}
                        {listRows.map((r, i) => {
                            const strategyPrice = priceWithMargin(r.costIncl, r.charges, r.strategyMargin);
                            const myPrice = priceWithMargin(r.costIncl, r.charges, r.margin);
                            const savedNum = parseFloat(r.salePrice);
                            const savedPrice = isFinite(savedNum) ? savedNum : null;
                            const mrpNum = parseFloat(r.mrp);
                            const mrp = isFinite(mrpNum) && mrpNum > 0 ? mrpNum : null;

                            // Barcode is computed from the Sale Price; its value is the POS cap.
                            const bc = savedPrice != null ? barcodePrice(savedPrice, mrp) : null;
                            const dateCode = secretDateCode(r.savedAt);

                            // Per-voice profit (after GST) — shown under each price for comparison.
                            const stratProfit = profitOf(strategyPrice, r.costIncl, r.charges, r.gst);
                            const myProfit = profitOf(myPrice, r.costIncl, r.charges, r.gst);
                            const savedProfit = profitOf(savedPrice, r.costIncl, r.charges, r.gst);

                            const dirty = r.salePrice.trim() !== r.baseline.trim();

                            // Per-voice profit sub-line (₹ + %), after tax — so all three can be compared.
                            const profitSub = (p: { amt: number; pct: number | null } | null) =>
                                p == null ? (
                                    <span className="block text-[10px] text-muted-foreground">—</span>
                                ) : (
                                    <span className={`block text-[10px] font-mono ${p.amt < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                        {rupee(p.amt)}{p.pct != null ? ` · ${p.pct.toFixed(1)}%` : ""}
                                    </span>
                                );

                            return (
                                <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                                    <TableCell>
                                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} aria-label={`Select ${r.name}`} />
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                    <TableCell>
                                        <Input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} className="h-7 text-xs" />
                                    </TableCell>
                                    {show("brand") ? (
                                    <TableCell>
                                        <Input value={r.brand} onChange={(e) => update(r.id, { brand: e.target.value })} placeholder="—" className="h-7 w-28 text-xs" />
                                    </TableCell>
                                    ) : null}
                                    {show("category") ? (
                                    <TableCell>
                                        <Input value={r.category} onChange={(e) => update(r.id, { category: e.target.value })} placeholder="—" className="h-7 w-28 text-xs" />
                                    </TableCell>
                                    ) : null}
                                    {show("group") ? (
                                    <TableCell>
                                        <Input value={r.group} onChange={(e) => update(r.id, { group: e.target.value })} placeholder="—" className="h-7 w-28 text-xs" />
                                    </TableCell>
                                    ) : null}
                                    {show("stock") ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={r.stock} onChange={(e) => update(r.id, { stock: e.target.value })} placeholder="0" className={`h-7 w-16 text-right text-xs font-mono ${stockQty(r) <= 0 ? "text-red-600" : ""}`} />
                                    </TableCell>
                                    ) : null}
                                    {show("method") ? (
                                    <TableCell>
                                        <Select value={r.method} onValueChange={(v) => update(r.id, { method: v as CostCode })}>
                                            <SelectTrigger className="h-7 w-16 text-xs font-mono"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {COST_METHODS.map((m) => (
                                                    <SelectItem key={m.code} value={m.code}>
                                                        <span className="font-mono">{m.code}</span>
                                                        <span className="ml-2 text-muted-foreground">{m.full}</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    ) : null}
                                    {show("cost") ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={r.costIncl} onChange={(e) => update(r.id, { costIncl: e.target.value })} className="h-7 w-24 text-right text-xs font-mono" />
                                    </TableCell>
                                    ) : null}
                                    {show("charges") ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={r.charges} onChange={(e) => update(r.id, { charges: e.target.value })} className="h-7 w-16 text-right text-xs font-mono" />
                                    </TableCell>
                                    ) : null}
                                    {show("margin") ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={r.margin} onChange={(e) => update(r.id, { margin: e.target.value })} className="h-7 w-16 text-right text-xs font-mono" />
                                    </TableCell>
                                    ) : null}

                                    {/* ── Strategy voice ── */}
                                    {show("strategy") ? (
                                    <TableCell className="p-1 text-right align-top">
                                        <button type="button" className={voiceClass(r.saleSource === "STRATEGY")} onClick={() => update(r.id, { saleSource: "STRATEGY" })}>
                                            {r.saleSource === "STRATEGY" ? SELLING_TAG : null}
                                            <span className="block text-sm font-mono font-semibold">{rupee(strategyPrice)}</span>
                                            {profitSub(stratProfit)}
                                        </button>
                                    </TableCell>
                                    ) : null}

                                    {/* ── Computed voice ── */}
                                    {show("computed") ? (
                                    <TableCell className="p-1 text-right align-top">
                                        <button type="button" className={voiceClass(r.saleSource === "MY")} onClick={() => update(r.id, { saleSource: "MY" })}>
                                            {r.saleSource === "MY" ? SELLING_TAG : null}
                                            <span className="block text-sm font-mono font-semibold">{rupee(myPrice)}</span>
                                            {profitSub(myProfit)}
                                        </button>
                                    </TableCell>
                                    ) : null}

                                    {/* ── Sale Price voice (editable, sticky) ── */}
                                    {show("sale") ? (
                                    <TableCell className="p-1 text-right align-top">
                                        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                                        <div className={voiceClass(r.saleSource === "SAVED")} onClick={() => update(r.id, { saleSource: "SAVED" })}>
                                            {r.saleSource === "SAVED" ? SELLING_TAG : null}
                                            <Input
                                                inputMode="decimal"
                                                value={r.salePrice}
                                                placeholder="—"
                                                onFocus={() => update(r.id, { saleSource: "SAVED" })}
                                                onChange={(e) => update(r.id, { salePrice: e.target.value })}
                                                className={`h-7 w-24 text-right text-xs font-mono font-semibold ${dirty ? "ring-1 ring-amber-400 focus-visible:ring-amber-400" : ""}`}
                                            />
                                            {profitSub(savedProfit)}
                                        </div>
                                    </TableCell>
                                    ) : null}

                                    {show("mrp") ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={r.mrp} placeholder="—" onChange={(e) => update(r.id, { mrp: e.target.value })} className="h-7 w-20 text-right text-xs font-mono" />
                                    </TableCell>
                                    ) : null}

                                    {/* ── Barcode (cap) + secret date code ── */}
                                    {show("barcode") ? (
                                    <TableCell className="text-right">
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
                                                    <span className="rounded bg-muted px-1 text-[9px] font-mono text-muted-foreground" title={`Barcode date code — frozen ${r.savedAt} (MM + 10-day third)`}>
                                                        {dateCode}
                                                    </span>
                                                ) : null}
                                            </span>
                                        )}
                                    </TableCell>
                                    ) : null}

                                    <TableCell>
                                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => remove(r.id)}>
                                            <Trash2 className="size-4 text-muted-foreground" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
                <div className="border-t p-2">
                    <Button type="button" variant="outline" size="sm" onClick={addRow}>
                        <Plus className="size-4" /> Add row
                    </Button>
                </div>
            </div>
        </>
    );

    return (
        <div className="h-full overflow-y-auto px-6 pt-4 pb-10">
            <div className="mb-3">
                <h1 className="text-lg font-semibold">Print labels — UI only</h1>
                <p className="text-sm text-muted-foreground">
                    Pick products (here or from a voucher), set the barcode price across three voices —{" "}
                    <span className="font-medium">Strategy</span>, <span className="font-medium">Computed</span>,{" "}
                    <span className="font-medium">Sale Price</span> — then print. Selected product &amp; Print share one set. Nothing is persisted here.
                </p>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "selected" | "print")}>
                <TabsList>
                    <TabsTrigger value="all">All products</TabsTrigger>
                    <TabsTrigger value="selected">
                        Selected product{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="print">
                        Print{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="all">{productBody}</TabsContent>
                <TabsContent value="selected">{productBody}</TabsContent>
                {/* forceMount keeps the designer's label settings alive across tab switches. */}
                <TabsContent value="print" forceMount className="data-[state=inactive]:hidden">
                    <LabelDesigner
                        items={printItems}
                        onAddProducts={addProducts}
                        onRemoveItem={removePrintItem}
                        pageTitle="Print labels"
                        pageSubtitle="The selected products as labels. Add more by search/scan or voucher; set prices in Selected product."
                        rootClassName="pb-10"
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
