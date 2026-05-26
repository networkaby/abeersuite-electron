"use client";

/**
 * PrintLabelsPage — pick products + quantities and print sheets of CODE128
 * barcode labels for sticking onto stock.
 *
 * Lives under the **Pricing Strategy** module (`/office/pricing-strategy/print-labels`)
 * because labels are only meaningful once a product has a sale price set, and
 * pricing-strategy is where that happens.
 *
 * - Reuses `InvProductCombobox` for product picking; adding the same product
 *   again increments its qty.
 * - Barcode value per product resolves in this order: `barcode1` → `sku`.
 *   (EAN-13 fields aren't surfaced here yet because CODE128 happily encodes
 *   SKU/barcode strings as-is; revisit when an EAN-13 use case lands.)
 * - Four label presets cover the common cases: A4 sheet 3×8 / A4 sheet 4×10
 *   (laser / inkjet on Avery-style label sheets), Thermal 50×25mm 1-up, and
 *   Thermal 50×25mm 2-up (True-Ally-style 2-Ups rolls).
 * - `window.print()` is the print pipeline. Print stylesheet hides the page
 *   chrome and renders only the labels grid. No server round-trip.
 *
 * **Prefill from a voucher** — when the page is opened with `?fromVoucher=<id>`,
 * the queue is seeded from the voucher's lines (`productId × ceil(quantity)`).
 * Used by the "Print labels" action on GRN and Purchase vouchers so receiving
 * goods → printing barcode stickers is a single hop.
 *
 * Permission: gated by `inventory:manage` via the parent route layout.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Printer, Trash2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InvProductCombobox, type SelectedProduct } from "./InvProductCombobox";
import { BarcodeSvg } from "./BarcodeSvg";

// ────────────────────────── prefill (voucher) ──────────────────────────

type VoucherLineFromApi = {
    productId: number;
    quantity:  string | number;
    mrpPaise:  number | null;
    product:   { id: number; sku: string; name: string };
};
type VoucherFromApi = {
    id:        number;
    type:      string;
    reference: string;
    lines:     VoucherLineFromApi[];
};

// ────────────────────────────── types ──────────────────────────────

type QueueRow = {
    productId:    number;
    name:         string;
    sku:          string;
    barcodeValue: string;   // resolved barcode1 → sku
    pricePaise:   number | null;   // sale / "Our Offer Price"
    mrpPaise:     number | null;   // printed MRP
    qty:          number;
};

type ProductLookupRow = {
    id:         number;
    sku:        string;
    name:       string;
    barcode1:   string | null;
    pricePaise: number | null;
    mrpPaise:   number | null;
};

// localStorage key for the persisted store header (business name + phone /
// any tag-line) — set once per browser; survives reloads so the operator
// doesn't re-type "NETWORK SERVICE, +91 8876996996" on every print run.
const HEADER_STORAGE_KEY = "print-labels:header";

type LabelPresetId = "a4-3x8" | "a4-4x10" | "thermal-50x25" | "thermal-50x25-2up";

type LabelPreset = {
    id:        LabelPresetId;
    label:     string;
    // CSS dimensions for one label
    width:     string;
    height:    string;
    // Grid columns (the print CSS handles row wrapping naturally)
    columns:   number;
    // Bar height inside the label, in pixels
    barHeight: number;
    fontSize:  number;
    // Page size — used by @page directive
    page:      "A4" | "thermal";
    // Thermal-only: physical page size on the roll. Defaults to width × height
    // when omitted. For multi-up rolls (e.g. True-Ally 50×25 2-up), set
    // pageWidth = width × columns so each printed page covers one row across
    // the carrier and the browser paginates after every row.
    pageWidth?:  string;
    pageHeight?: string;
};

const PRESETS: LabelPreset[] = [
    { id: "a4-3x8",             label: "A4 sheet — 3 × 8 (24 per page)",                 width: "63.5mm", height: "33.9mm", columns: 3, barHeight: 30, fontSize: 11, page: "A4" },
    { id: "a4-4x10",            label: "A4 sheet — 4 × 10 (40 per page)",                width: "48.5mm", height: "25.4mm", columns: 4, barHeight: 22, fontSize: 9,  page: "A4" },
    { id: "thermal-50x25",      label: "Thermal — 50 × 25mm (1-up roll)",                width: "50mm",   height: "25mm",   columns: 1, barHeight: 26, fontSize: 9,  page: "thermal", pageWidth: "50mm",  pageHeight: "25mm" },
    { id: "thermal-50x25-2up",  label: "Thermal — 50 × 25mm 2-up roll (True-Ally etc.)", width: "50mm",   height: "25mm",   columns: 2, barHeight: 26, fontSize: 9,  page: "thermal", pageWidth: "100mm", pageHeight: "25mm" },
];

// ────────────────────────────── helpers ──────────────────────────────

/**
 * Parse the qty text input. Empty → 0. Non-digits stripped. Clamped to a sane
 * range so a typo doesn't try to render 10,000 labels.
 *
 * Per AGENTS.md: no `input type="number"`; this is the validator the text
 * input pipes its value through.
 */
function sanitizeQty(input: string): number {
    const digits = input.replace(/\D+/g, "");
    if (!digits) return 0;
    const n = Number.parseInt(digits, 10);
    if (Number.isNaN(n)) return 0;
    return Math.min(n, 500);
}

function resolveBarcodeValue(p: { barcode1: string | null; sku: string }): string {
    return (p.barcode1 && p.barcode1.trim()) || p.sku;
}

// ────────────────────────────── component ──────────────────────────────

export function PrintLabelsPage() {
    const [queue, setQueue]       = useState<QueueRow[]>([]);
    const [presetId, setPresetId] = useState<LabelPresetId>("a4-3x8");
    const [showHeader, setShowHeader] = useState(true);
    const [showName,   setShowName]   = useState(true);
    const [showMrp,    setShowMrp]    = useState(true);
    const [showPrice,  setShowPrice]  = useState(true);

    // Store header — business name + phone / tagline. Persisted in
    // localStorage so the operator types it once. Empty string = no header
    // line on the label (toggle also hides it explicitly).
    //
    // Lazy initializer reads from localStorage on first client render. On
    // the server `window` is undefined, so the SSR pass renders an empty
    // header; React reconciles to the stored value on the client without a
    // visible flash because the labels grid isn't rendered until the user
    // adds a product (well after hydration).
    const [headerText, setHeaderText] = useState<string>(() => {
        if (typeof window === "undefined") return "";
        try { return window.localStorage.getItem(HEADER_STORAGE_KEY) ?? ""; }
        catch { return ""; }
    });
    useEffect(() => {
        try { window.localStorage.setItem(HEADER_STORAGE_KEY, headerText); }
        catch { /* ignore — private mode / disabled storage */ }
    }, [headerText]);

    // Banner shown after a successful voucher prefill — surfaces the source
    // reference so the user knows where the queue came from. Set by the
    // prefill effect below; cleared the moment the user changes the queue
    // (so it doesn't become stale).
    const [prefillSource, setPrefillSource] = useState<{ type: string; reference: string } | null>(null);

    // Lookup cache so we can resolve `barcode1` for products picked through
    // the combobox (the SelectedProduct type doesn't carry it). The voucher
    // prefill below also reads from this map.
    const [lookupById, setLookupById] = useState<Map<number, ProductLookupRow>>(new Map());
    const [lookupLoaded, setLookupLoaded] = useState(false);
    useEffect(() => {
        axios.get<ProductLookupRow[]>("/api/inventory/products/lookup")
            .then((r) => {
                const m = new Map<number, ProductLookupRow>();
                for (const p of r.data) m.set(p.id, p);
                setLookupById(m);
                setLookupLoaded(true);
            })
            .catch(() => toast.error("Failed to load product lookup"));
    }, []);

    // ── Prefill from voucher when `?fromVoucher=<id>` is set ────────────
    // Waits for the product lookup so barcode1 / pricePaise resolve correctly
    // per line. Lines with no qty (or qty ≤ 0) are skipped; non-integer
    // quantities are rounded up so a "1.5 PCS" GRN row still yields 2 labels.
    const search = useSearchParams();
    const voucherIdParam = search.get("fromVoucher");
    useEffect(() => {
        if (!voucherIdParam || !lookupLoaded) return;
        const voucherId = Number.parseInt(voucherIdParam, 10);
        if (!Number.isFinite(voucherId)) return;
        let cancelled = false;
        axios.get<VoucherFromApi>(`/api/inventory/vouchers/${voucherId}`)
            .then((r) => {
                if (cancelled) return;
                const v = r.data;
                const rows: QueueRow[] = [];
                for (const line of v.lines) {
                    const qty = Math.ceil(Math.max(0, Number(line.quantity) || 0));
                    if (qty <= 0) continue;
                    const lookup = lookupById.get(line.productId);
                    rows.push({
                        productId:    line.productId,
                        name:         line.product.name,
                        sku:          line.product.sku,
                        barcodeValue: resolveBarcodeValue({
                            barcode1: lookup?.barcode1 ?? null,
                            sku:      line.product.sku,
                        }),
                        pricePaise:   lookup?.pricePaise ?? null,
                        // PURCHASE / GRN lines snapshot MRP at receipt time —
                        // prefer that over the product's current cached MRP so
                        // the label matches what was just received.
                        mrpPaise:     line.mrpPaise ?? lookup?.mrpPaise ?? null,
                        qty:          Math.min(qty, 500),
                    });
                }
                if (rows.length === 0) {
                    toast.error(`Voucher ${v.reference} has no printable lines`);
                    return;
                }
                setQueue(rows);
                setPrefillSource({ type: v.type, reference: v.reference });
                const missingPrice = rows.filter((r) => r.pricePaise == null).length;
                if (missingPrice > 0) {
                    toast.warning(
                        `${missingPrice} product${missingPrice === 1 ? "" : "s"} have no sale price — set one in Pricing Strategy → Items before printing if you want prices on the labels.`,
                    );
                }
            })
            .catch(() => toast.error("Failed to load voucher"));
        return () => { cancelled = true; };
    }, [voucherIdParam, lookupLoaded, lookupById]);

    const preset = useMemo(
        () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0],
        [presetId],
    );

    function addProduct(sp: SelectedProduct | null) {
        if (!sp) return;
        setPrefillSource(null);
        setQueue((rows) => {
            const existing = rows.findIndex((r) => r.productId === sp.id);
            if (existing >= 0) {
                const next = [...rows];
                next[existing] = { ...next[existing], qty: Math.min(next[existing].qty + 1, 500) };
                return next;
            }
            const lookup = lookupById.get(sp.id);
            return [
                ...rows,
                {
                    productId:    sp.id,
                    name:         sp.name,
                    sku:          sp.sku,
                    barcodeValue: resolveBarcodeValue({
                        barcode1: lookup?.barcode1 ?? null,
                        sku:      sp.sku,
                    }),
                    pricePaise:   sp.salePrice != null ? Math.round(sp.salePrice * 100) : null,
                    mrpPaise:     sp.mrp       != null ? Math.round(sp.mrp       * 100) : null,
                    qty:          1,
                },
            ];
        });
    }

    function updateQty(productId: number, qty: number) {
        setQueue((rows) =>
            rows.map((r) => (r.productId === productId ? { ...r, qty } : r)),
        );
        setPrefillSource(null);
    }

    function removeRow(productId: number) {
        setQueue((rows) => rows.filter((r) => r.productId !== productId));
        setPrefillSource(null);
    }

    function clearAll() {
        setQueue([]);
        setPrefillSource(null);
    }

    const totalLabels = queue.reduce((acc, r) => acc + r.qty, 0);

    // Flatten qty into individual label slots for the print grid.
    const labels = useMemo(() => {
        const out: QueueRow[] = [];
        for (const r of queue) {
            for (let i = 0; i < r.qty; i++) out.push(r);
        }
        return out;
    }, [queue]);

    function handlePrint() {
        if (totalLabels === 0) {
            toast.error("Add at least one product");
            return;
        }
        window.print();
    }

    // Build dynamic @page rule per preset.
    // Thermal rolls: each printed page is one row of labels across the carrier
    // (pageWidth = label width × columns, pageHeight = single label height).
    // The browser paginates naturally after each row.
    const printPageRule =
        preset.page === "thermal"
            ? `@page { size: ${preset.pageWidth ?? preset.width} ${preset.pageHeight ?? preset.height}; margin: 0; }`
            : `@page { size: A4; margin: 8mm; }`;

    return (
        <div className="space-y-4">
            {/* Non-print toolbar / settings — hidden via .print-hide in CSS. */}
            <div className="print-hide space-y-4">
                {prefillSource && (
                    <div className="rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
                        Queue prefilled from <strong>{prefillSource.type}</strong>{" "}
                        <span className="font-mono">{prefillSource.reference}</span>. Adjust quantities below or clear to start over.
                    </div>
                )}
                <div className="rounded-md border border-border bg-card p-4 space-y-3">
                    <h2 className="font-semibold">Add products</h2>
                    <div className="max-w-xl">
                        {/* Each pick resets the combobox by calling addProduct
                            and immediately clearing its own value (combobox
                            internally re-syncs to value=null). */}
                        <InvProductCombobox
                            value={null}
                            onChange={addProduct}
                            placeholder="Search / scan a product to add to the print queue…"
                            allowCreate={false}
                            autoFocus
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Tip: scan a barcode with a USB scanner — the combobox matches by SKU / barcode and adds the product (re-scanning the same item increments qty by 1).
                    </p>
                </div>

                <div className="rounded-md border border-border bg-card p-4 space-y-3">
                    <h2 className="font-semibold">Label settings</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-sm font-medium">Layout</span>
                            <Select value={presetId} onValueChange={(v) => setPresetId(v as LabelPresetId)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PRESETS.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                        <div className="space-y-2">
                            <span className="text-sm font-medium">Show on label</span>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={showHeader} onCheckedChange={(v) => setShowHeader(v === true)} />
                                    Store header
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={showName}   onCheckedChange={(v) => setShowName(v === true)} />
                                    Product name
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={showMrp}    onCheckedChange={(v) => setShowMrp(v === true)} />
                                    MRP
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={showPrice}  onCheckedChange={(v) => setShowPrice(v === true)} />
                                    Offer price
                                </label>
                            </div>
                        </div>
                    </div>
                    <label className="flex flex-col gap-1">
                        <span className="text-sm font-medium">Store header text</span>
                        <Input
                            type="text"
                            value={headerText}
                            onChange={(e) => setHeaderText(e.target.value)}
                            placeholder="e.g. NETWORK SERVICE, +91 8876996996"
                            maxLength={80}
                        />
                        <span className="text-[11px] text-muted-foreground">
                            Saved in this browser. Leave blank or untick &ldquo;Store header&rdquo; to omit.
                        </span>
                    </label>
                </div>

                <div className="rounded-md border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Queue ({totalLabels} {totalLabels === 1 ? "label" : "labels"})</h2>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={clearAll} disabled={queue.length === 0}>
                                Clear
                            </Button>
                            <Button size="sm" onClick={handlePrint} disabled={totalLabels === 0}>
                                <Printer className="size-4" />
                                Print {totalLabels > 0 ? `(${totalLabels})` : ""}
                            </Button>
                        </div>
                    </div>
                    {queue.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            No products yet. Use the picker above to add one.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Barcode value</TableHead>
                                    <TableHead className="w-[160px]">Qty</TableHead>
                                    <TableHead className="w-[60px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {queue.map((row) => (
                                    <TableRow key={row.productId}>
                                        <TableCell>
                                            <div className="font-medium">{row.name}</div>
                                            <div className="text-[11px] text-muted-foreground font-mono">{row.sku}</div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{row.barcodeValue}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="size-7"
                                                    onClick={() => updateQty(row.productId, Math.max(0, row.qty - 1))}
                                                    aria-label="Decrease qty"
                                                >
                                                    <Minus className="size-3" />
                                                </Button>
                                                <Input
                                                    type="text"
                                                    inputMode="numeric"
                                                    className="h-7 w-14 text-center"
                                                    value={String(row.qty)}
                                                    onChange={(e) => updateQty(row.productId, sanitizeQty(e.target.value))}
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="size-7"
                                                    onClick={() => updateQty(row.productId, Math.min(500, row.qty + 1))}
                                                    aria-label="Increase qty"
                                                >
                                                    <Plus className="size-3" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7 text-destructive"
                                                onClick={() => removeRow(row.productId)}
                                                aria-label="Remove"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>

                {labels.length > 0 && (
                    <div className="rounded-md border border-border bg-card p-4 space-y-3">
                        <h2 className="font-semibold">Preview</h2>
                        <p className="text-xs text-muted-foreground">
                            On-screen preview is approximate. Use your browser&apos;s Print Preview (Ctrl+P) to verify alignment against your label sheet before printing the full run.
                        </p>
                    </div>
                )}
            </div>

            {/* The labels grid. Print stylesheet flips this from preview to
                actual print layout via the .label-sheet / .label scope. */}
            <style>{printPageRule}</style>
            <div
                className="label-sheet"
                data-page-mode={preset.page}
                style={{
                    // CSS custom props the @media print rules read from.
                    ["--label-w"  as string]: preset.width,
                    ["--label-h"  as string]: preset.height,
                    ["--label-cols" as string]: String(preset.columns),
                }}
            >
                {labels.map((row, idx) => {
                    const hasMrp   = showMrp   && row.mrpPaise   != null;
                    const hasPrice = showPrice && row.pricePaise != null;
                    const hasMeta  = hasMrp || hasPrice;
                    return (
                        <div key={`${row.productId}-${idx}`} className="label">
                            {showHeader && headerText.trim() && (
                                <div className="label-header">{headerText}</div>
                            )}
                            <div className="label-barcode">
                                <BarcodeSvg
                                    value={row.barcodeValue}
                                    height={preset.barHeight}
                                    fontSize={preset.fontSize}
                                    margin={2}
                                />
                            </div>
                            {showName && <div className="label-name">{row.name}</div>}
                            {hasMeta && (
                                <div className="label-meta">
                                    {hasMrp && (
                                        <span className="label-mrp">
                                            MRP ₹{(row.mrpPaise! / 100).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                                        </span>
                                    )}
                                    {hasPrice && (
                                        <span className="label-price">
                                            Our Offer Price ₹{Math.round(row.pricePaise! / 100)}/-
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
