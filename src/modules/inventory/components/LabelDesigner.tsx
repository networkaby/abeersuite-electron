"use client";

/**
 * LabelDesigner (UI only) — the barcode-label view of the Print tab.
 *
 * It is a CONTROLLED view: the parent owns the product set and passes it in as
 * `items`. The designer never holds its own product list — adding (search/scan
 * or voucher) calls `onAddProducts`, removing calls `onRemoveItem`, so the same
 * products stay in sync with the Selected product tab. Prices/dates are set in
 * that tab; here the labels are read-only and just rendered + printed.
 *
 * Copies: each label carries its own count (how many to print). The parent owns
 * it like everything else — the designer just shows the input and repeats the
 * label that many times in the print sheet. See `defaultCopies` for the rule that
 * picks the starting number (stock qty when re-priced, incoming qty otherwise).
 *
 * Secret date code: staff-only price age. See `lib/secretDateCode.ts`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { cn } from "@/shared/lib/format/utils";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FileText, Loader2, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import {
    clampCopies, nameFitScale, LABEL_NAME_FONT,
    type AddedProduct, type Item,
} from "@/modules/inventory/lib/labelItems";
import { secretBucketLabel, secretDateCode } from "@/modules/inventory/lib/secretDateCode";
import type { LabelTemplate } from "@/shared/lib/schemas/orgDefaultsSchemas";

// ── Public types (shape lives in lib/labelItems — re-exported for call sites) ──

export type { Item, AddedProduct };

/** Preview cap — a re-priced product can be hundreds of copies; the print sheet
 *  emits every one, but the on-screen preview stops here to stay responsive. */
const PREVIEW_LIMIT = 60;

// ── Label size presets (mm) ──────────────────────────────────────────────────

/** `media` decides the @page box:
 *  - "roll"  — one printed page = ONE row of labels, sized to the physical web
 *              (cols × w  ×  h) with zero margin. This is what a gap-sensor
 *              thermal printer wants: it feeds exactly one row per page. The
 *              page must match the driver's stock or Chrome shrinks to fit.
 *  - "sheet" — ordinary A4 sheet of label stock, many rows per page.
 *  `cols` on a roll is the "up" count of the stock (2-up = 2 labels across). */
type Preset = {
    id: string; label: string; w: number; h: number; cols: number; rows: number;
    barHeight: number; fontSize: number; media: "roll" | "sheet";
};
const PRESETS: Preset[] = [
    // Matches the 4BARCODE driver stock "50 x 25 2up (100.0 mm x 25.0 mm)".
    { id: "thermal-50x25", label: "Thermal 50 × 25 mm (2-up roll)", w: 50, h: 25, cols: 2, rows: 1, barHeight: 34, fontSize: 11, media: "roll" },
    { id: "a4-3x8", label: "A4 3×8 — 63.5 × 33.9 mm", w: 63.5, h: 33.9, cols: 3, rows: 8, barHeight: 36, fontSize: 13, media: "sheet" },
    { id: "a4-4x10", label: "A4 4×10 — 48.5 × 25.4 mm", w: 48.5, h: 25.4, cols: 4, rows: 10, barHeight: 26, fontSize: 10, media: "sheet" },
];

/** Labels on one printed page. A roll page is a single row (the printer feeds
 *  one row per page); an A4 sheet holds rows × cols. */
const perPage = (p: Preset) => p.cols * p.rows;

/** Code defaults for anything the saved template does not carry. */
const LABEL_TEMPLATE_DEFAULTS = {
    presetId:       PRESETS[0].id,
    showHeader:     true,
    header:         "NETWORK SERVICE",
    showMrp:        true,
    showSecret:     true,
    salePriceLabel: "",
    side:           "right" as "left" | "right",
    orientation:    "spine" as "spine" | "upright",
};

// ── Voucher prefill (Pick from GRN / Purchase) ────────────────────────────────
type VoucherListRow = { id: number; type: string; reference: string; date: string; partyName: string | null; _count?: { lines: number } };
type VoucherLineFromApi = { productId: number; quantity: string | number; mrpPaise: number | null; product: { id: number; sku: string; name: string } };
type VoucherFromApi = { id: number; type: string; reference: string; lines: VoucherLineFromApi[] };
type ProductLookupRow = { id: number; sku: string; name: string; barcode1: string | null; pricePaise: number | null; mrpPaise: number | null; stock: number | null };

// ── Props ─────────────────────────────────────────────────────────────────────

type LabelDesignerProps = {
    /** The labels to render — owned by the parent (the shared product set). */
    items: Item[];
    /** Add products to the shared set (from search/scan or a voucher). */
    onAddProducts: (products: AddedProduct[]) => void;
    /** Drop a label from the shared set. */
    onRemoveItem: (id: number) => void;
    /** Change how many copies of one label to print. */
    onCopiesChange: (id: number, copies: number) => void;
    /** Go to the price/barcode editor (parent switches sub-tab). Button hidden if omitted. */
    onUpdateBarcode?: () => void;
    /** Deep-link prefill: when set, this GRN/Purchase voucher's lines are added
     *  to the set once, on mount (after the product lookup resolves). */
    prefillVoucherId?: number | null;
    /** Called after a prefill voucher has been processed (parent can clear the URL). */
    onPrefillConsumed?: () => void;
    pageTitle?: string;
    pageSubtitle?: string;
    /** Root wrapper classes — embedded panels use the parent's scroll/padding. */
    rootClassName?: string;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function LabelDesigner({
    items,
    onAddProducts,
    onRemoveItem,
    onCopiesChange,
    onUpdateBarcode,
    prefillVoucherId = null,
    onPrefillConsumed,
    pageTitle = "Print labels",
    pageSubtitle = "Pick products, then print.",
    rootClassName = "pb-10",
}: LabelDesignerProps) {
    // Global label options (apply to every label). Seeded from the code defaults,
    // then replaced by the saved org template once it loads.
    const [showHeader, setShowHeader] = useState(LABEL_TEMPLATE_DEFAULTS.showHeader);
    const [header, setHeader] = useState(LABEL_TEMPLATE_DEFAULTS.header);
    const [showMrp, setShowMrp] = useState(LABEL_TEMPLATE_DEFAULTS.showMrp);
    const [showSecret, setShowSecret] = useState(LABEL_TEMPLATE_DEFAULTS.showSecret);
    const [salePriceLabel, setSalePriceLabel] = useState(LABEL_TEMPLATE_DEFAULTS.salePriceLabel);
    const [side, setSide] = useState<"left" | "right">(LABEL_TEMPLATE_DEFAULTS.side);
    const [orientation, setOrientation] = useState<"spine" | "upright">(LABEL_TEMPLATE_DEFAULTS.orientation);
    const [presetId, setPresetId] = useState(LABEL_TEMPLATE_DEFAULTS.presetId);
    // Preview magnification only — never printed, so it is NOT part of the saved
    // template. 1 = the sheet at its true physical size on screen.
    const [zoom, setZoom] = useState(1.5);
    const [settingsOpen, setSettingsOpen] = useState(true);

    // ── Saved label template (OrgDefaults.labelTemplateJson) ──────────────────
    const [savingTemplate, setSavingTemplate] = useState(false);
    useEffect(() => {
        axios.get<{ labelTemplateJson?: LabelTemplate | null }>("/api/settings/org-defaults")
            .then((r) => {
                const t = r.data.labelTemplateJson;
                if (!t) return;
                if (t.presetId != null && PRESETS.some((p) => p.id === t.presetId)) setPresetId(t.presetId);
                if (t.showHeader != null) setShowHeader(t.showHeader);
                if (t.header != null) setHeader(t.header);
                if (t.showMrp != null) setShowMrp(t.showMrp);
                if (t.showSecret != null) setShowSecret(t.showSecret);
                if (t.salePriceLabel != null) setSalePriceLabel(t.salePriceLabel);
                if (t.side != null) setSide(t.side);
                if (t.orientation != null) setOrientation(t.orientation);
            })
            .catch(() => { /* code defaults stand */ });
    }, []);

    async function saveTemplate() {
        setSavingTemplate(true);
        try {
            const labelTemplateJson: LabelTemplate = {
                presetId, showHeader, header, showMrp, showSecret, salePriceLabel, side, orientation,
            };
            await axios.patch("/api/settings/org-defaults", { labelTemplateJson });
            toast.success("Label design saved");
        } catch {
            toast.error("Failed to save label design");
        } finally {
            setSavingTemplate(false);
        }
    }

    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

    // ── Add product via the shared combobox (search + scan, real lookup) ───────
    // pickCount remounts the combobox after each add so it clears + refocuses.
    const [pickCount, setPickCount] = useState(0);
    const addFromCombobox = (sp: SelectedProduct | null) => {
        if (!sp) return;
        setPickCount((c) => c + 1);
        onAddProducts([{
            id: sp.id,
            name: sp.name,
            barcode: sp.sku,
            salePrice: sp.salePrice ?? null,
            costPrice: sp.costPrice ?? null,
            mrp: sp.mrp ?? null,
            stock: sp.stock,
        }]);
    };

    // ── Pick from GRN / Purchase voucher ──────────────────────────────────────
    // Product lookup map (resolves barcode1 + sale/MRP for voucher lines).
    const [lookupById, setLookupById] = useState<Map<number, ProductLookupRow>>(new Map());
    const [lookupLoaded, setLookupLoaded] = useState(false);
    useEffect(() => {
        axios.get<ProductLookupRow[]>("/api/inventory/products/lookup")
            .then((r) => setLookupById(new Map(r.data.map((p) => [p.id, p]))))
            .catch(() => { /* combobox will surface lookup issues */ })
            .finally(() => setLookupLoaded(true));
    }, []);

    const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
    const [voucherList, setVoucherList] = useState<VoucherListRow[] | null>(null);
    const [voucherSearch, setVoucherSearch] = useState("");
    const [voucherTypeFilter, setVoucherTypeFilter] = useState<"all" | "GRN" | "PURCHASE">("all");
    const [voucherLoading, setVoucherLoading] = useState(false);

    async function loadVoucherList(force = false) {
        if (voucherList && !force) return;
        setVoucherLoading(true);
        try {
            const [grn, pur] = await Promise.all([
                axios.get<VoucherListRow[]>("/api/inventory/vouchers", { params: { type: "GRN", status: "POSTED" } }),
                axios.get<VoucherListRow[]>("/api/inventory/vouchers", { params: { type: "PURCHASE", status: "POSTED" } }),
            ]);
            const merged = [...grn.data, ...pur.data].sort((a, b) =>
                a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.id < b.id ? 1 : -1));
            setVoucherList(merged);
        } catch {
            toast.error("Failed to load vouchers");
        } finally {
            setVoucherLoading(false);
        }
    }
    const openVoucherPicker = () => { setVoucherPickerOpen(true); loadVoucherList(); };

    // Fetch one GRN/Purchase voucher and add its lines to the shared set. One
    // product = one label row; repeat lines of the same product add their units
    // together, because the received qty is what seeds the copies count.
    // Shared by the picker dialog and the ?fromVoucher deep-link prefill.
    async function addVoucherById(id: number) {
        try {
            const r = await axios.get<VoucherFromApi>(`/api/inventory/vouchers/${id}`);
            const byBarcode = new Map<string, AddedProduct>();
            for (const line of r.data.lines) {
                const qty = Math.ceil(Math.max(0, Number(line.quantity) || 0));
                if (qty <= 0) continue;
                const lookup = lookupById.get(line.productId);
                const barcode = line.product.sku?.trim() || (lookup?.barcode1 && lookup.barcode1.trim()) || String(line.productId);
                const already = byBarcode.get(barcode);
                if (already) { already.incomingQty = (already.incomingQty ?? 0) + qty; continue; }
                const mrpPaise = line.mrpPaise ?? lookup?.mrpPaise ?? null;
                byBarcode.set(barcode, {
                    id: line.productId,
                    name: line.product.name,
                    barcode,
                    salePrice: lookup?.pricePaise != null ? lookup.pricePaise / 100 : null,
                    costPrice: null,
                    mrp: mrpPaise != null ? mrpPaise / 100 : null,
                    incomingQty: qty,
                    stock: lookup?.stock ?? null,
                });
            }
            const products = [...byBarcode.values()];
            if (products.length) onAddProducts(products);
            toast.success(products.length ? `Added ${products.length} product${products.length === 1 ? "" : "s"} from ${r.data.reference}` : `No products in ${r.data.reference}`);
        } catch {
            toast.error("Failed to load voucher");
        }
    }

    async function pickVoucher(v: VoucherListRow) {
        setVoucherPickerOpen(false);
        await addVoucherById(v.id);
    }

    // Deep-link prefill (?fromVoucher=<id>): run once, after the product lookup
    // has settled so barcodes/prices resolve. The ref guard survives re-renders
    // (incl. the parent clearing the URL via onPrefillConsumed).
    const prefilledRef = useRef(false);
    useEffect(() => {
        if (prefilledRef.current || prefillVoucherId == null || !lookupLoaded) return;
        prefilledRef.current = true;
        void addVoucherById(prefillVoucherId).finally(() => onPrefillConsumed?.());
        // addVoucherById/onPrefillConsumed intentionally omitted — guarded to run once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillVoucherId, lookupLoaded]);

    const filteredVouchers = useMemo(() => {
        if (!voucherList) return [];
        const q = voucherSearch.trim().toLowerCase();
        return voucherList.filter((v) => {
            if (voucherTypeFilter !== "all" && v.type !== voucherTypeFilter) return false;
            if (!q) return true;
            return v.reference.toLowerCase().includes(q) || (v.partyName ?? "").toLowerCase().includes(q);
        });
    }, [voucherList, voucherSearch, voucherTypeFilter]);

    // One entry per printed label — a product with 12 copies expands to 12 cards.
    // The sheet prints every one; the preview shows the first PREVIEW_LIMIT.
    const printLabels = useMemo(
        () => items.flatMap((it) =>
            Array.from({ length: clampCopies(it.copies) }, (_, k) => ({ key: `${it.id}-${k}`, item: it }))),
        [items],
    );
    const totalCopies = printLabels.length;

    // Labels cut into PRINTED PAGES. The preview and the print sheet both render
    // this same list with the same .lt-page box, so the preview cannot drift from
    // the output — it used to be a separate reflowing flex grid, which is why it
    // looked nothing like the paper.
    const pages = useMemo(() => {
        const n = perPage(preset);
        const out: { key: string; item: Item }[][] = [];
        for (let i = 0; i < printLabels.length; i += n) out.push(printLabels.slice(i, i + n));
        return out;
    }, [printLabels, preset]);

    /** Whole pages worth of PREVIEW_LIMIT labels — never a half-drawn page. */
    const previewPageCap = Math.max(1, Math.ceil(PREVIEW_LIMIT / perPage(preset)));

    /** Geometry of one page — the physical sheet/row the printer feeds. */
    const pageStyle = {
        ["--label-cols" as string]: preset.cols,
        ["--label-w" as string]: `${preset.w}mm`,
        ["--label-h" as string]: `${preset.h}mm`,
        ["--page-w" as string]: `${preset.cols * preset.w}mm`,
        ["--page-h" as string]: `${preset.rows * preset.h}mm`,
    } as React.CSSProperties;

    // How far each product's name must be condensed to fit this preset. Keyed by
    // product, NOT by label, so copies cost nothing. The usable width is the label
    // minus its own 1.5mm side padding and the body's 3mm side padding (the gutter
    // kept clear down both edges for the secret code).
    const nameScaleById = useMemo(() => {
        const availableMm = preset.w - 2 * 1.5 - 2 * 3;
        const fontSizePt = 7; // .lt-name
        return new Map(items.map((it) => [it.id, nameFitScale(it.name, availableMm, fontSizePt)]));
    }, [items, preset.w]);

    const secretStyle: React.CSSProperties = {
        writingMode: "vertical-rl",
        textOrientation: orientation === "upright" ? "upright" : "mixed",
        [side === "left" ? "left" : "right"]: "0.4mm",
    };

    return (
        <div className={cn(rootClassName)}>
            <style>{labelCss + pageCss(preset)}</style>

            <div className="print-hide mb-4 flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-lg font-semibold">{pageTitle}</h1>
                    <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    {onUpdateBarcode ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onUpdateBarcode}
                            title="Go to Update price / barcode to set prices and stamp today's date"
                        >
                            <Save className="size-4" /> Update barcode{items.length > 0 ? ` (${items.length})` : ""}
                        </Button>
                    ) : null}
                    <Button type="button" variant={settingsOpen ? "secondary" : "outline"} onClick={() => setSettingsOpen((o) => !o)}>
                        <SlidersHorizontal className="size-4" /> {settingsOpen ? "Hide settings" : "Settings"}
                    </Button>
                    <Button onClick={() => window.print()} disabled={items.length === 0}>Print (real size)</Button>
                </div>
            </div>

            {/* ── Global label options ─────────────────────────────────────── */}
            {settingsOpen ? (
                <div className="print-hide mb-4 flex flex-wrap items-end gap-4 rounded-sm border bg-muted/30 p-3">
                    <Opt label="Store header">
                        <div className="flex items-center gap-2">
                            <Checkbox checked={showHeader} onCheckedChange={(v) => setShowHeader(!!v)} />
                            <Input value={header} onChange={(e) => setHeader(e.target.value)} className="h-8 w-64 text-xs" />
                        </div>
                    </Opt>
                    <Opt label="Show MRP">
                        <Checkbox checked={showMrp} onCheckedChange={(v) => setShowMrp(!!v)} />
                    </Opt>
                    <Opt label="Sale price caption">
                        <Input
                            value={salePriceLabel}
                            onChange={(e) => setSalePriceLabel(e.target.value)}
                            placeholder="none"
                            maxLength={16}
                            className="h-8 w-28 text-xs"
                            title="Printed before the selling price, e.g. Offer or Rate. Leave empty to print the price on its own."
                        />
                    </Opt>
                    <Opt label="Show secret code">
                        <Checkbox checked={showSecret} onCheckedChange={(v) => setShowSecret(!!v)} />
                    </Opt>
                    <Opt label="Code side">
                        <Select value={side} onValueChange={(v) => setSide(v as "left" | "right")}>
                            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="left">Left edge</SelectItem>
                                <SelectItem value="right">Right edge</SelectItem>
                            </SelectContent>
                        </Select>
                    </Opt>
                    <Opt label="Code orientation">
                        <Select value={orientation} onValueChange={(v) => setOrientation(v as "spine" | "upright")}>
                            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="spine">Spine (rotated)</SelectItem>
                                <SelectItem value="upright">Upright (stacked)</SelectItem>
                            </SelectContent>
                        </Select>
                    </Opt>
                    <Opt label="Label size">
                        <Select value={presetId} onValueChange={setPresetId}>
                            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </Opt>
                    <Opt label={`Preview zoom ×${zoom}`}>
                        <input type="range" min={1} max={5} step={0.5} value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-40" />
                    </Opt>
                    <Opt label="&nbsp;">
                        <Button type="button" variant="outline" size="sm" onClick={saveTemplate} disabled={savingTemplate}>
                            {savingTemplate ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            Save design
                        </Button>
                    </Opt>
                </div>
            ) : null}

            {/* ── Add product — search / scan + voucher pick ─────────────────── */}
            <div className="print-hide mb-4 flex items-center gap-2">
                <div className="flex h-11 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
                    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <InvProductCombobox
                        key={pickCount}
                        value={null}
                        onChange={addFromCombobox}
                        placeholder="Search / scan a product to add…"
                        allowCreate={false}
                        autoFocus
                        className="flex-1"
                    />
                </div>
                <Button type="button" variant="outline" className="h-11" onClick={openVoucherPicker}>
                    <FileText className="size-4" /> Pick from GRN / Purchase
                </Button>
            </div>

            {/* ── Items table (read-only — prices/dates are set in Selected product) ─ */}
            <div className="print-hide mb-6 rounded-sm border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8 text-xs">#</TableHead>
                            <TableHead className="text-xs">Product name</TableHead>
                            <TableHead className="text-xs">Barcode</TableHead>
                            <TableHead className="text-right text-xs">Sale ₹</TableHead>
                            <TableHead className="text-right text-xs">MRP ₹</TableHead>
                            <TableHead className="text-xs">Price date</TableHead>
                            <TableHead className="text-center text-xs">Secret code</TableHead>
                            <TableHead className="text-right text-xs">Stock</TableHead>
                            <TableHead className="text-center text-xs">Copies</TableHead>
                            <TableHead className="w-8" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                                    No labels yet — search/scan above, pick a voucher, or add products in the Selected product tab.
                                </TableCell>
                            </TableRow>
                        ) : null}
                        {items.map((it, i) => {
                            const code = secretDateCode(it.date);
                            return (
                                <TableRow key={it.id}>
                                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                    <TableCell className="text-xs font-medium">{it.name}</TableCell>
                                    <TableCell className="font-mono text-xs">{it.barcode || "—"}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">₹{it.price}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{it.mrp && it.mrp !== "0" ? `₹${it.mrp}` : "—"}</TableCell>
                                    <TableCell className="font-mono text-xs">{it.date || "—"}</TableCell>
                                    <TableCell className="text-center">
                                        <span className="font-mono text-sm font-semibold">{code || "—"}</span>
                                        {code ? (
                                            <div className="text-[10px] text-muted-foreground">
                                                {code.slice(0, 2)} · {secretBucketLabel(Number(code.slice(2)))}
                                            </div>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs">{it.stock ?? "—"}</TableCell>
                                    <TableCell className="text-center">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={999}
                                            value={it.copies}
                                            onChange={(e) => onCopiesChange(it.id, clampCopies(parseInt(e.target.value, 10)))}
                                            className="mx-auto h-7 w-16 text-center text-xs font-mono"
                                            aria-label={`Copies of ${it.name}`}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => onRemoveItem(it.id)}>
                                            <Trash2 className="size-4 text-muted-foreground" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* ── Preview: the real pages, at real size ────────────────────────
                Same .lt-page boxes the printer gets, so this IS the output — the
                only difference is `zoom` magnifying it (zoom, not transform, so
                the enlarged sheet takes real layout height instead of clipping). */}
            <div className="print-hide">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                    Preview — {totalCopies} label{totalCopies !== 1 ? "s" : ""} from {items.length} product{items.length !== 1 ? "s" : ""}
                    {" · "}{pages.length} page{pages.length !== 1 ? "s" : ""} of {preset.cols * preset.w}×{preset.rows * preset.h}mm
                    {zoom !== 1 ? ` · shown ×${zoom}` : " · actual size"}
                    {pages.length > previewPageCap ? ` · showing first ${previewPageCap}` : ""}
                </div>
                <div className="overflow-x-auto rounded-sm border bg-[#fafafa] p-6">
                    <div className="lt-preview" style={{ zoom }}>
                        {pages.slice(0, previewPageCap).map((pageLabels, i) => (
                            <div key={i} className="lt-page" style={pageStyle}>
                                {pageLabels.map(({ key, item }) => (
                                    <LabelCard key={key} preset={preset} item={item}
                                        header={showHeader ? header : ""} showMrp={showMrp}
                                        code={showSecret ? secretDateCode(item.date) : ""} side={side} secretStyle={secretStyle}
                                        nameScale={nameScaleById.get(item.id) ?? 1} salePriceLabel={salePriceLabel} />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Print-only: every copy, one .lt-page per printed page ──────── */}
            <div className="label-print-area">
                {pages.map((pageLabels, i) => (
                    <div key={i} className="lt-page" style={pageStyle}>
                        {pageLabels.map(({ key, item }) => (
                            <LabelCard key={key} preset={preset} item={item}
                                header={showHeader ? header : ""} showMrp={showMrp}
                                code={showSecret ? secretDateCode(item.date) : ""} side={side} secretStyle={secretStyle}
                                nameScale={nameScaleById.get(item.id) ?? 1} salePriceLabel={salePriceLabel} />
                        ))}
                    </div>
                ))}
            </div>

            {/* ── Pick from GRN / Purchase — adds voucher lines to the shared set ─ */}
            <Dialog open={voucherPickerOpen} onOpenChange={setVoucherPickerOpen}>
                <DialogContent className="max-w-3xl! print-hide">
                    <DialogHeader>
                        <DialogTitle>Pick a GRN or Purchase voucher</DialogTitle>
                        <DialogDescription>
                            Adds each line as a label, with its received qty as the copies count.
                            Only POSTED vouchers are shown.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input value={voucherSearch} onChange={(e) => setVoucherSearch(e.target.value)} placeholder="Search by reference or party…" className="h-8 max-w-xs" autoFocus />
                        <Select value={voucherTypeFilter} onValueChange={(v) => setVoucherTypeFilter(v as "all" | "GRN" | "PURCHASE")}>
                            <SelectTrigger className="h-8 w-35"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="GRN">GRN</SelectItem>
                                <SelectItem value="PURCHASE">Purchase</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" size="sm" onClick={() => loadVoucherList(true)} disabled={voucherLoading}>
                            {voucherLoading ? <Loader2 className="size-4 animate-spin" /> : null} Refresh
                        </Button>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto rounded-md border">
                        {voucherLoading && !voucherList ? (
                            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading…</div>
                        ) : filteredVouchers.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">No matching vouchers.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-25">Date</TableHead>
                                        <TableHead className="w-22.5">Type</TableHead>
                                        <TableHead>Reference</TableHead>
                                        <TableHead>Party</TableHead>
                                        <TableHead className="w-17.5 text-right">Lines</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredVouchers.map((v) => (
                                        <TableRow key={v.id} className="cursor-pointer" onClick={() => pickVoucher(v)}>
                                            <TableCell className="text-xs tabular-nums">{new Date(v.date).toLocaleDateString("en-IN", { year: "2-digit", month: "short", day: "2-digit" })}</TableCell>
                                            <TableCell className="text-xs">{v.type}</TableCell>
                                            <TableCell className="font-mono text-xs">{v.reference}</TableCell>
                                            <TableCell className="text-xs">{v.partyName ?? "—"}</TableCell>
                                            <TableCell className="text-right text-xs tabular-nums">{v._count?.lines ?? "—"}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Label card ───────────────────────────────────────────────────────────────

function LabelCard({
    preset, item, header, showMrp, code, side, secretStyle, nameScale = 1, salePriceLabel = "",
}: {
    preset: Preset;
    item: Item;
    header: string;
    showMrp: boolean;
    code: string;
    side: "left" | "right";
    secretStyle: React.CSSProperties;
    /** Horizontal squeeze for the name, from nameFitScale. 1 = fits as-is. */
    nameScale?: number;
    /** Caption before the selling price ("Offer"). Empty = price prints bare. */
    salePriceLabel?: string;
}) {
    return (
        <div className="lt-label" style={{ ["--label-w" as string]: `${preset.w}mm`, ["--label-h" as string]: `${preset.h}mm` }}>
            {code ? <span className={`lt-secret lt-secret-${side}`} style={secretStyle}>{code}</span> : null}
            <div className="lt-body">
                {header ? <div className="lt-header">{header}</div> : null}
                {/* The inner span is laid out 1/scale WIDER than the box, then
                    squeezed back to exactly the box width — so the ellipsis (if
                    the name is still too long at the floor) lands in the right
                    place instead of at the unscaled width. */}
                {item.name ? (
                    <div className="lt-name">
                        <span
                            className="lt-name-fit"
                            style={nameScale < 1
                                ? { transform: `scaleX(${nameScale})`, width: `${100 / nameScale}%` }
                                : undefined}
                        >
                            {item.name}
                        </span>
                    </div>
                ) : null}
                {/* The readable digits are HTML, NOT jsbarcode's own text: inside
                    the SVG they shrank along with the bars, so a 13-digit code
                    printed far smaller than a 6-digit one. Out here they are the
                    same size on every label whatever the code length. */}
                <div className="lt-barcode" style={{ ["--bar-h" as string]: `${preset.barHeight}px` }}>
                    <BarcodeSvg value={item.barcode} height={preset.barHeight} showText={false} margin={0} stretch />
                </div>
                {item.barcode ? (
                    <div className="lt-code" style={{ fontSize: `${preset.fontSize}px` }}>{item.barcode}</div>
                ) : null}
                <div className="lt-meta">
                    {showMrp && item.mrp && item.mrp !== "0" ? <span className="lt-mrp">MRP ₹{item.mrp}</span> : <span />}
                    {item.price ? (
                        <span className="lt-price">
                            {salePriceLabel ? `${salePriceLabel} ` : ""}₹{item.price}/-
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// ── Small inline option helper ───────────────────────────────────────────────

function Opt({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

// ── Label styles (scoped) ─────────────────────────────────────────────────────

/** `@page` can't read CSS variables, so the page box is baked per preset.
 *  A roll page is exactly one row of labels — the same box the printer driver
 *  declares as its stock — so Chrome prints at true size with no shrink-to-fit. */
const pageCss = (p: Preset) => p.media === "roll"
    ? `@page { size: ${p.w * p.cols}mm ${p.h}mm; margin: 0; }`
    : `@page { size: A4; margin: 4mm; }`;

const labelCss = `
/* One printed page. Identical on screen and on paper — the preview only adds a
   hairline so you can see where the sheet ends. */
.lt-page {
    display: grid;
    grid-template-columns: repeat(var(--label-cols, 2), var(--label-w, 50mm));
    grid-auto-rows: var(--label-h, 25mm);
    width: var(--page-w, 100mm);
    height: var(--page-h, 25mm);
    gap: 0;
    box-sizing: border-box;
    background: #fff;
    overflow: hidden;
}
/* Screen only: page separation + a shadow so stacked pages read as sheets. */
.lt-preview { display: flex; flex-direction: column; gap: 4mm; align-items: flex-start; }
.lt-preview .lt-page { box-shadow: 0 0 0 1px #d4d4d4, 0 1px 3px rgba(0,0,0,0.12); }
.lt-label {
    position: relative;
    width: var(--label-w, 50mm);
    height: var(--label-h, 25mm);
    box-sizing: border-box;
    padding: 1mm 1.5mm;
    outline: 0.5px dashed #ccc;
    color: #000;
    background: #fff;
    font-family: ui-sans-serif, system-ui, sans-serif;
}
.lt-body {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    text-align: center;
    padding: 0 3mm; /* room down both edges for the side code */
}
.lt-header {
    font-size: 7pt; font-weight: 700; line-height: 1.1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.5mm;
}
.lt-name {
    font-size: 7pt; font-weight: 600; line-height: 1.1;
    font-family: ${LABEL_NAME_FONT};
    overflow: hidden; margin: 0.5mm 0;
}
.lt-name-fit {
    display: block; transform-origin: left center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lt-barcode { flex: 0 0 auto; display: block; width: 100%; }
/* Full width, fixed height — see the stretch note in BarcodeSvg. Every label's
   bars are the same size regardless of how many digits the code has. */
.lt-barcode svg { display: block; width: 100%; height: var(--bar-h, 28px); }
.lt-code {
    font-family: ui-monospace, "Courier New", monospace;
    font-weight: 600;
    line-height: 1.1; letter-spacing: 0.2px; margin-top: 0.3mm;
}
.lt-meta {
    display: flex; justify-content: space-between; align-items: baseline;
    width: 100%; gap: 1mm; font-size: 7pt; line-height: 1.1; margin-top: 0.5mm;
}
.lt-mrp { font-weight: 600; text-align: left; }
.lt-price { font-weight: 700; text-align: right; margin-left: auto; }

/* The secret date code — vertical, pinned to one edge, staff-only. */
/* Centred by transform, NOT by flex inside a top+bottom box. The old way made
   the box height depend on top+bottom and then centred the glyphs with flex in
   vertical writing-mode — screen resolved that as centred, paged media could
   resolve it as start-aligned, so the code printed high on the label while the
   preview showed it centred. top:50% + translateY(-50%) is unambiguous in both.
   The box is now its own content height, so it can no longer touch the edges
   either — that is what used to shave "075" down to "75" on feed drift. */
.lt-secret {
    position: absolute; top: 50%; transform: translateY(-50%);
    font-size: 6pt; font-weight: 700; letter-spacing: 1px; color: #000;
    line-height: 1;
}

/* Screen: the print-only grid is hidden. */
.label-print-area { display: none; }

@media print {
    .print-hide { display: none !important; }
    html, body { height: auto !important; overflow: visible !important; background: #fff; }
    /* Only the label sheet prints. Everything that is neither the sheet, inside
       it, nor an ancestor of it is REMOVED FROM LAYOUT. This used to be
       body-star visibility:hidden, but hidden boxes keep their height, so
       the app shell (sidebar + quick-actions rail) still emitted several blank
       pages after the labels. :has() picks out the ancestor chain to spare. */
    body *:not(:has(.label-print-area)):not(.label-print-area):not(.label-print-area *) {
        display: none !important;
    }
    /* The spared ancestors must not impose their own scroll box or padding. */
    body :has(.label-print-area) {
        display: block !important; height: auto !important; max-height: none !important;
        overflow: visible !important; padding: 0 !important; margin: 0 !important; border: 0 !important;
    }
    /* Pages stack; each .lt-page is exactly one @page box, so one page of labels
       lands on one sheet and the preview above is literally the same layout. */
    .label-print-area { display: block !important; }
    .lt-page + .lt-page { break-before: page; }
    .lt-page { box-shadow: none; }
    .lt-label { outline: none; break-inside: avoid; }
}
`;
