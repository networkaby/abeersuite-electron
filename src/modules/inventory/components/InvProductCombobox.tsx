"use client";

/**
 * InvProductCombobox — Tally-style inline product search.
 *
 * Renders a plain text input; as the user types, a dropdown opens in a
 * portal (position: fixed) so it escapes the parent <ScrollArea> /
 * <table> overflow and never gets clipped or covered by the totals footer
 * / action bar below. Mirrors GlAccountCombobox's portal+fixed pattern.
 *
 * Layout of the dropdown (top → bottom):
 *   1. "+ New product" CTA (top — closest to the cursor; Enter on no-match
 *      also triggers this)
 *   2. Column headers (Item / Sale / Cost / MRP / Stock)
 *   3. Scrollable hit list (maxHeight clamped to viewport)
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import {
    useComboboxNav, useProductCatalog, invalidateProductCatalog,
    useDropdownPortal, useValueChange, type DropdownPlacement,
} from "@/shared/hooks";
import { primaryBarcode, searchProducts, findByExactCode } from "@/shared/lib/inventory";
import { NewProductDialog, type AdvancedDefaults, type CreatedProductOption } from "./NewProductDialog";
import { InvProductDialog, type InvProductCreatedRow } from "./InvProductDialog";
import type { InvProductFormState } from "./InvProductFormFields";

type ProductOption = {
    id: number;
    sku: string;
    name: string;
    stock: number | null;
    lowStockThreshold: number;
    pricePaise: number | null;   // sale price
    lastPurchasePaise: number | null;   // last inward rate (derived from ledger walk)
    mrpPaise: number | null;
    unit: { code: string };
    brand: { name: string } | null;
    barcode1: string | null;
    codes?: { kind: string; value: string }[];
};

export type SelectedProduct = {
    id: number;
    sku: string;
    name: string;
    unitCode: string;
    stock: number | null;
    salePrice: number | null;   // in ₹ (converted from paise)
    costPrice: number | null;
    mrp: number | null;
};

type Props = {
    /** Currently selected product id (null = nothing selected) */
    value: number | null;
    /** Called when user selects a product from the dropdown */
    onChange: (product: SelectedProduct | null) => void;
    /** Placeholder shown in the input */
    placeholder?: string;
    className?: string;
    /** Auto-focus the input on mount */
    autoFocus?: boolean;
    /** Products not to offer (e.g. the ones already in a variant family). */
    excludeIds?: number[];
    /** Hide the Cost Price column — for screens whose staff should not see cost (shop / variants). */
    hideCost?: boolean;
    /**
     * When true (default), shows a "+ New product" CTA at the top of the
     * dropdown that opens an inline quick-create dialog. Pass `false` from
     * call sites where creating a product mid-flow doesn't make sense
     * (e.g. a Journal Voucher dialog that only looks up existing inventory).
     */
    allowCreate?: boolean;
    /**
     * Bump this to tell the box "the pick you just reported was not taken —
     * clear yourself". Needed because the box shows the chosen name straight
     * away, so a parent that declines a pick (the trading voucher merging a
     * repeated item into an existing line) would otherwise leave a stale name
     * sitting over a blank row. Any increase clears the text.
     */
    clearNonce?: number;
};

const formatINR = (paise: number | null) =>
    paise != null
        ? formatInr(paise / 100)
        : "—";

function toSelected(p: ProductOption): SelectedProduct {
    return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        unitCode: p.unit.code,
        stock: p.stock,
        salePrice: p.pricePaise != null ? p.pricePaise / 100 : null,
        costPrice: p.lastPurchasePaise != null ? p.lastPurchasePaise / 100 : null,
        mrp: p.mrpPaise != null ? p.mrpPaise / 100 : null,
    };
}

/** Rows the dropdown will mount at once. Everything past this needs a
 *  narrower query — see the note on `filtered`. */
const MAX_ROWS = 50;

const VIEWPORT_MARGIN = 12;
const DROPDOWN_RIGHT_TRIM = 38; // ~1cm — pull the right edge in from the table edge
// The four number columns take ~590px (4 × fixed width + gaps + padding), so
// anything narrower leaves the Item column — the product NAME — no room at
// all. Outside a table the box itself can be far narrower than that.
const DROPDOWN_MIN_W = 880;
const PLACEMENT: DropdownPlacement = {
    maxHeight: 360, flipBelow: 200, minHeight: 120,
    size: (rect, wrapper) => {
        const tableRect = wrapper.closest("table")?.getBoundingClientRect();
        const naturalWidth = tableRect ? tableRect.right - rect.left : rect.width;
        // Never wider than the window; slide left rather than run off its edge.
        const width = Math.min(
            Math.max(DROPDOWN_MIN_W, naturalWidth - DROPDOWN_RIGHT_TRIM),
            window.innerWidth - 2 * VIEWPORT_MARGIN,
        );
        const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN - width));
        return { width, left };
    },
};

export function InvProductCombobox({ value, onChange, placeholder = "Search item…", className = "", autoFocus = false, allowCreate = true, clearNonce = 0, excludeIds, hideCost = false }: Props) {
    // Shared IndexedDB-backed catalogue — same array every picker on the page
    // reads, kept fresh by delta sync + realtime (see useProductCatalog).
    const { products: catalogProducts, loading } = useProductCatalog<ProductOption>();
    // A product made from this box shows up here INSTANTLY, before the catalogue
    // sync it triggers (invalidateProductCatalog) lands — that sync is what
    // brings it to every other picker on the page.
    const [justCreated, setJustCreated] = useState<ProductOption[]>([]);
    // Memoised: a fresh array every render would re-run the ranked search below
    // on every keystroke's re-render, not just when the query or catalogue moved.
    const products = useMemo(
        () => (justCreated.length === 0
            ? catalogProducts
            : [...catalogProducts, ...justCreated.filter((jc) => !catalogProducts.some((p) => p.id === jc.id))]),
        [catalogProducts, justCreated],
    );
    const [createOpen, setCreateOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [advancedDefaults, setAdvancedDefaults] = useState<Partial<InvProductFormState> | undefined>();

    // When value changes externally, update the display text — while rendering.
    // Null while the picked product is not in the catalogue yet: typing stays.
    // Keyed on the name, so a catalogue re-read leaves typing alone.
    const selectedProduct = products.find((p) => p.id === value);
    const syncTo = selectedProduct ? selectedProduct.name : !value ? "" : null;
    const [query, setQuery] = useState(syncTo ?? "");
    if (useValueChange(syncTo) && syncTo !== null) setQuery(syncTo);
    // The box shows the picked product's name the moment it is picked, before
    // the parent has had its say. When the parent DECLINES the pick — the
    // trading voucher merges a repeat into the line that already has it and
    // blanks this row — `value` never changes, so syncQuery has nothing to
    // react to and the stale name would sit there over an empty line. The
    // parent bumps this counter to say "I cleared you".
    if (useValueChange(clearNonce) && clearNonce > 0) setQuery("");

    // Ranked by the same tiered search the till uses, so an exact SKU or
    // barcode sorts to the top and a run-together query ("a4paper") still
    // finds its product. No guess fallback here: a voucher line is a
    // deliberate choice, so an empty list is honest rather than unhelpful.
    //
    // The cap matters as much as the ranking. This dropdown opens on FOCUS,
    // and an uncapped list mounted one <li> per catalogue row — the same shape
    // as the ledger dropdown that used to block the main thread for 1.8s. The
    // footer tells the operator why the list stops.
    const gridCols = hideCost
        ? "grid-cols-[minmax(0,1fr)_110px_110px_70px]"
        : "grid-cols-[minmax(0,1fr)_140px_140px_140px_100px]";
    const excludeKey = excludeIds?.join(",") ?? "";
    const offered = useMemo(() => {
        if (!excludeKey) return products;
        const skip = new Set(excludeKey.split(",").map(Number));
        return products.filter((p) => !skip.has(p.id));
    }, [products, excludeKey]);
    const filtered = useMemo(
        () => (query.trim()
            ? searchProducts(offered, query, { rows: MAX_ROWS }).rows
            : offered.slice(0, MAX_ROWS)),
        [offered, query],
    );
    const truncated = filtered.length >= MAX_ROWS;

    const cb = useComboboxNav({
        count: filtered.length,
        onSelect: (i) => {
            const p = filtered[i];
            if (!p) return;
            setQuery(p.name);
            cb.setOpen(false);
            onChange(toSelected(p));
        },
        onClear: () => { setQuery(""); onChange(null); },
    });
    const { wrapperRef, inputRef, listRef } = cb;

    // ── Portal + position (useDropdownPortal) — inside the surrounding dialog so
    // its scroll lock keeps wheel scrolling in the list. Width tracks the
    // surrounding <table>'s right edge so it spans the row (Tally / Vyapar
    // style); see PLACEMENT. ──────────────────────────────────────────────
    const { target: portalTarget, pos } = useDropdownPortal(cb.open, wrapperRef, PLACEMENT);

    // Wrap handleKeyDown to add Tab commit-on-exit + Enter-creates-when-empty.
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Alt+C → open the quick-create dialog from anywhere in the combobox.
        if (e.altKey && e.key.toLowerCase() === "c" && allowCreate) {
            e.preventDefault();
            cb.setOpen(false);
            setCreateOpen(true);
            return;
        }
        if (cb.open && e.key === "Tab") {
            const normalizedQuery = query.trim().toLowerCase();
            const normalizedSelected = (selectedProduct?.name ?? "").trim().toLowerCase();
            const hasTypedInput = normalizedQuery.length > 0;
            const shouldCommit = hasTypedInput && normalizedQuery !== normalizedSelected;
            if (shouldCommit && filtered[cb.highlighted]) {
                const p = filtered[cb.highlighted];
                setQuery(p.name);
                cb.setOpen(false);
                onChange(toSelected(p));
            } else {
                cb.setOpen(false);
            }
            return;
        }
        // A SCANNED BARCODE ends in Enter, and that Enter must land the product
        // whose code was scanned — never whichever row the highlight happens to
        // sit on. Ranking alone puts an exact code first, but "alone" is not a
        // guarantee, and the cost of being wrong here is the wrong item on a
        // purchase bill. So an exact SKU / barcode match short-circuits
        // everything below, highlight included.
        if (e.key === "Enter" && query.trim().length > 0) {
            const scanned = findByExactCode(products, query);
            if (scanned) {
                e.preventDefault();
                setQuery(scanned.name);
                cb.setOpen(false);
                onChange(toSelected(scanned));
                return;
            }
        }
        // No matches + a typed query + create allowed → Enter opens the
        // quick-create dialog. Mirrors PartySearchAndCreate's "Enter on
        // no-result to create" affordance so cashiers can finish a sale
        // without leaving the table.
        if (cb.open && e.key === "Enter" && allowCreate && filtered.length === 0 && query.trim().length > 0) {
            e.preventDefault();
            cb.setOpen(false);
            setCreateOpen(true);
            return;
        }
        cb.handleKeyDown(e);
    };

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <input
                ref={inputRef}
                type="text"
                value={query}
                autoFocus={autoFocus}
                placeholder={placeholder}
                className="w-full bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
                onChange={(e) => {
                    setQuery(e.target.value);
                    cb.setHighlighted(0);
                    cb.setOpen(true);
                    if (!e.target.value) onChange(null);
                }}
                onFocus={() => cb.setOpen(true)}
                onBlur={cb.handleBlur}
                onKeyDown={onKeyDown}
            />

            {cb.open && portalTarget && pos && createPortal(
                <div
                    // z-[60] sits above shadcn Dialog's z-50 backdrop + the
                    // TradingVoucherPage action bar (no explicit z but rendered
                    // later in DOM). overflow-hidden clips inner list to
                    // maxHeight so the dropdown never spills past viewport.
                    className="fixed z-60 mt-0.5 overflow-hidden rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{
                        top: pos.top,
                        left: pos.left,
                        width: pos.width,
                        maxHeight: pos.maxHeight,
                        transform: pos.flipUp ? "translateY(calc(-100% - 0.25rem))" : undefined,
                    }}
                    onMouseDown={cb.dropdownMouseDown}
                >
                    {/* + New product CTA at the TOP — closest to the cursor.
                        Acts on mousedown, like the rows. */}
                    {allowCreate && (
                        <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); setCreateOpen(true); cb.setOpen(false); }}
                            className="w-full border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-primary hover:bg-muted text-left flex items-center gap-1.5"
                        >
                            <Plus size={12} />
                            New product{query.trim() ? `: ${query.trim()}` : ""}
                        </button>
                    )}

                    {/* Column headers */}
                    <div className={`grid ${gridCols} gap-x-3 border-b border-border bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>
                        <span>Item</span>
                        <span className="text-right">Sale Price</span>
                        {hideCost ? null : <span className="text-right">Cost Price</span>}
                        <span className="text-right">MRP</span>
                        <span className="text-right">Stock</span>
                    </div>

                    {loading && products.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading items…</div>
                    ) : filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                            No items match <span className="font-mono">{query}</span>
                        </div>
                    ) : (
                        // Native overflow-y on a sized container — shadcn
                        // ScrollArea's viewport doesn't honour a max-height
                        // parent reliably, so its scrollbar wouldn't appear
                        // with long lists.
                        <div
                            className="overflow-y-auto"
                            style={{ maxHeight: pos.maxHeight - 90 /* CTA + header + chrome */ }}
                        >
                            <ul ref={listRef} className="divide-y divide-border">
                                {filtered.map((p, i) => {
                                    const isLow = p.stock != null && p.stock <= p.lowStockThreshold;
                                    const stockZero = p.stock === 0;
                                    return (
                                        <li
                                            key={p.id}
                                            onMouseDown={() => {
                                                setQuery(p.name);
                                                cb.setOpen(false);
                                                onChange(toSelected(p));
                                            }}
                                            onMouseEnter={() => cb.setHighlighted(i)}
                                            className={`grid ${gridCols} gap-x-3 cursor-pointer px-3 py-2 transition-colors ${i === cb.highlighted ? "bg-accent" : "hover:bg-accent/60"
                                                }`}
                                        >
                                            {/* Name + SKU + brand + barcode */}
                                            <div className="min-w-0 overflow-hidden">
                                                <div className="font-medium truncate">{p.name}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono truncate">
                                                    {p.sku} · {p.unit.code}
                                                    {p.brand ? ` · ${p.brand.name}` : ""}
                                                    {p.barcode1 ? ` · ${p.barcode1}` : ""}
                                                </div>
                                            </div>
                                            {/* Sale price */}
                                            <span className="text-right text-xs tabular-nums self-center">
                                                {formatINR(p.pricePaise)}
                                            </span>
                                            {/* Cost price — derived from LAST_INWARD walk (PR 3) */}
                                            {hideCost ? null : (
                                                <span className="text-right text-xs tabular-nums text-muted-foreground self-center">
                                                    {formatINR(p.lastPurchasePaise)}
                                                </span>
                                            )}
                                            {/* MRP */}
                                            <span className="text-right text-xs tabular-nums text-muted-foreground self-center">
                                                {formatINR(p.mrpPaise)}
                                            </span>
                                            {/* Stock */}
                                            <span className={`text-right text-xs font-semibold tabular-nums self-center ${stockZero ? "text-destructive" : isLow ? "text-orange-500" : "text-green-600"
                                                }`}>
                                                {p.stock ?? "—"}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            {truncated && (
                                <div className="border-t border-border bg-muted/40 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
                                    Showing first {MAX_ROWS} — type more to narrow down
                                </div>
                            )}
                        </div>
                    )}
                </div>,
                portalTarget,
            )}

            {/* Quick-create dialog — pre-fills name from the current query.
                On success, append to the in-memory products list and auto-select. */}
            {allowCreate && (
                <NewProductDialog
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    initialName={query.trim()}
                    onCreated={(np: CreatedProductOption) => {
                        setJustCreated((ps) => [...ps, np]);
                        void invalidateProductCatalog();
                        setQuery(np.name);
                        onChange(toSelected(np));
                    }}
                    onAdvanced={(d: AdvancedDefaults) => {
                        setAdvancedDefaults({
                            name: d.name,
                            sku: d.sku,
                            unitId: d.unitId,
                            priceRupees: d.priceRupees,
                            costRupees: d.costRupees,
                        });
                        setAdvancedOpen(true);
                    }}
                />
            )}

            {/* Full product editor — opened from the quick-create "Advanced…" button.
                On save, append the new product to the in-memory list and auto-select. */}
            {allowCreate && (
                <InvProductDialog
                    open={advancedOpen}
                    onOpenChange={setAdvancedOpen}
                    editId={null}
                    defaultValues={advancedDefaults}
                    onCreatedProduct={(raw: InvProductCreatedRow) => {
                        const np: CreatedProductOption = {
                            id: raw.id,
                            sku: raw.sku,
                            name: raw.name,
                            stock: raw.stock,
                            lowStockThreshold: raw.lowStockThreshold,
                            pricePaise: raw.effectiveSalePricePaise,
                            lastPurchasePaise: raw.lastPurchasePaise,
                            mrpPaise: raw.mrpPaise,
                            unit: { code: raw.unit.code },
                            brand: raw.brand,
                            barcode1: primaryBarcode(raw.codes),
                        };
                        setJustCreated((ps) => [...ps, np]);
                        void invalidateProductCatalog();
                        setQuery(np.name);
                        onChange(toSelected(np));
                    }}
                />
            )}

            {/* Clear button when a product is selected */}
            {value && (
                <button
                    type="button"
                    onMouseDown={cb.clear}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground/65 hover:text-muted-foreground text-base leading-none pr-1"
                    tabIndex={-1}
                >
                    ×
                </button>
            )}
        </div>
    );
}
