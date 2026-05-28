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

import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Plus } from "lucide-react";
import { useComboboxNav } from "@/shared/hooks";
import { NewProductDialog, type AdvancedDefaults, type CreatedProductOption } from "./NewProductDialog";
import { InvProductDialog, type InvProductCreatedRow } from "./InvProductDialog";
import type { InvProductFormState } from "./InvProductFormFields";

type ProductOption = {
    id:         number;
    sku:        string;
    name:       string;
    stock:      number | null;
    lowStockThreshold: number;
    pricePaise: number | null;   // sale price
    lastPurchasePaise: number | null;   // last inward rate (derived from ledger walk)
    mrpPaise:   number | null;
    unit:       { code: string };
    brand:      { name: string } | null;
    barcode1:   string | null;
};

export type SelectedProduct = {
    id:          number;
    sku:         string;
    name:        string;
    unitCode:    string;
    stock:       number | null;
    salePrice:   number | null;   // in ₹ (converted from paise)
    costPrice:   number | null;
    mrp:         number | null;
};

type Props = {
    /** Currently selected product id (null = nothing selected) */
    value:     number | null;
    /** Called when user selects a product from the dropdown */
    onChange:  (product: SelectedProduct | null) => void;
    /** Placeholder shown in the input */
    placeholder?: string;
    className?: string;
    /** Auto-focus the input on mount */
    autoFocus?: boolean;
    /**
     * When true (default), shows a "+ New product" CTA at the top of the
     * dropdown that opens an inline quick-create dialog. Pass `false` from
     * call sites where creating a product mid-flow doesn't make sense
     * (e.g. a Journal Voucher dialog that only looks up existing inventory).
     */
    allowCreate?: boolean;
};

const formatINR = (paise: number | null) =>
    paise != null
        ? `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

function toSelected(p: ProductOption): SelectedProduct {
    return {
        id:        p.id,
        sku:       p.sku,
        name:      p.name,
        unitCode:  p.unit.code,
        stock:     p.stock,
        salePrice: p.pricePaise != null ? p.pricePaise / 100 : null,
        costPrice: p.lastPurchasePaise != null ? p.lastPurchasePaise / 100 : null,
        mrp:       p.mrpPaise   != null ? p.mrpPaise   / 100 : null,
    };
}

export function InvProductCombobox({ value, onChange, placeholder = "Search item…", className = "", autoFocus = false, allowCreate = true }: Props) {
    const [products, setProducts]   = useState<ProductOption[]>([]);
    const [query, setQuery]         = useState("");
    const [loading, setLoading]     = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [advancedDefaults, setAdvancedDefaults] = useState<Partial<InvProductFormState> | undefined>();

    // Load all products once (cached in memory for fast typing)
    useEffect(() => {
        setLoading(true);
        axios.get<ProductOption[]>("/api/inventory/products/lookup")
            .then((r) => setProducts(r.data))
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    // When value changes externally, update the display text
    const selectedProduct = products.find((p) => p.id === value);
    const syncQuery = useCallback(() => {
        if (selectedProduct) {
            setQuery(selectedProduct.name);
        } else if (!value) {
            setQuery("");
        }
    }, [selectedProduct, value]);
    useEffect(syncQuery, [syncQuery]);

    const filtered = query.trim()
        ? products.filter((p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.sku.toLowerCase().includes(query.toLowerCase()) ||
            (p.barcode1 ?? "").includes(query)
          )
        : products;

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

    // ── Portal target — body by default, or the surrounding dialog content so
    // that Radix Dialog's react-remove-scroll allow-list keeps wheel scrolling
    // working inside the dropdown. (Same trick as GlAccountCombobox.) ────────
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    useEffect(() => {
        const w = cb.wrapperRef.current;
        if (!w) return;
        const inDialog = w.closest('[data-slot="dialog-content"]') as HTMLElement | null;
        setPortalTarget(inDialog ?? document.body);
    }, [cb.wrapperRef]);

    // ── Position the dropdown via fixed + computed top/left/width. ───────────
    // Width tracks the surrounding <table>'s right edge so it spans the row
    // (Tally / Vyapar style). MaxHeight is clamped to actually-available
    // space so long product lists never spill past the viewport. Flip up
    // when bottom space is cramped.
    const DROPDOWN_MAX_H = 360;
    const VIEWPORT_MARGIN = 12;
    const [pos, setPos] = useState<{
        top: number; left: number; width: number; maxHeight: number; flipUp: boolean;
    } | null>(null);
    useLayoutEffect(() => {
        if (!cb.open || !portalTarget) { setPos(null); return; }
        const wrapper = cb.wrapperRef.current;
        if (!wrapper) return;
        const measure = () => {
            const rect = wrapper.getBoundingClientRect();
            const target = portalTarget.getBoundingClientRect();
            const table = wrapper.closest("table");
            const tableRect = table?.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
            const spaceAbove = rect.top - VIEWPORT_MARGIN;
            const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
            const available = Math.max(120, flipUp ? spaceAbove : spaceBelow);
            const maxHeight = Math.min(DROPDOWN_MAX_H, available);
            const width = Math.max(
                420,
                tableRect ? tableRect.right - rect.left : rect.width,
            );
            const anchorY = flipUp ? rect.top : rect.bottom;
            setPos({
                top:  anchorY - target.top,
                left: rect.left - target.left,
                width,
                maxHeight,
                flipUp,
            });
            cb.setDropdownWidth(width);
        };
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [cb.open, cb.wrapperRef, cb.setDropdownWidth, portalTarget]);

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

    // Keep the list ref pointing at the scrollable inner div so keyboard
    // navigation auto-scrolls the highlighted item into view.
    const listRef = useRef<HTMLUListElement>(null);
    // eslint-disable-next-line react-hooks/immutability
    useEffect(() => { cb.listRef.current = listRef.current; });

    return (
        <div ref={cb.wrapperRef} className={`relative ${className}`}>
            <input
                ref={cb.inputRef}
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
                    className="fixed z-[60] mt-0.5 overflow-hidden rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{
                        top:   pos.top,
                        left:  pos.left,
                        width: pos.width,
                        maxHeight: pos.maxHeight,
                        transform: pos.flipUp ? "translateY(calc(-100% - 0.25rem))" : undefined,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {/* + New product CTA at the TOP — closest to the cursor.
                        onMouseDown (not onClick) so we beat the input's blur
                        which would otherwise close the dropdown before the
                        click registers. */}
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
                    <div className="grid grid-cols-[minmax(0,1fr)_140px_140px_140px_100px] gap-x-3 border-b border-border bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span>Item</span>
                        <span className="text-right">Sale Price</span>
                        <span className="text-right">Cost Price</span>
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
                                    const isLow     = p.stock != null && p.stock <= p.lowStockThreshold;
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
                                            className={`grid grid-cols-[minmax(0,1fr)_140px_140px_140px_100px] gap-x-3 cursor-pointer px-3 py-2 transition-colors ${
                                                i === cb.highlighted ? "bg-accent" : "hover:bg-accent/60"
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
                                            <span className="text-right text-xs tabular-nums text-muted-foreground self-center">
                                                {formatINR(p.lastPurchasePaise)}
                                            </span>
                                            {/* MRP */}
                                            <span className="text-right text-xs tabular-nums text-muted-foreground self-center">
                                                {formatINR(p.mrpPaise)}
                                            </span>
                                            {/* Stock */}
                                            <span className={`text-right text-xs font-semibold tabular-nums self-center ${
                                                stockZero ? "text-destructive" : isLow ? "text-orange-500" : "text-green-600"
                                            }`}>
                                                {p.stock ?? "—"}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
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
                        setProducts((ps) => [...ps, np]);
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
                            pricePaise: raw.pricePaise,
                            lastPurchasePaise: raw.lastPurchasePaise,
                            mrpPaise: raw.mrpPaise,
                            unit: { code: raw.unit.code },
                            brand: raw.brand,
                            barcode1: raw.barcode1,
                        };
                        setProducts((ps) => [...ps, np]);
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
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground text-base leading-none pr-1"
                    tabIndex={-1}
                >
                    ×
                </button>
            )}
        </div>
    );
}
