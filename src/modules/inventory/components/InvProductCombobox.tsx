"use client";

/**
 * InvProductCombobox — Tally-style inline product search.
 * Renders a plain text input; as the user types, a dropdown appears
 * directly below showing matching products with stock/price columns.
 * No dialog — everything is inline for fast entry.
 */

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useComboboxNav } from "@/shared/hooks";
import { ScrollArea } from "@/components/ui/scroll-area";

type ProductOption = {
    id:         number;
    sku:        string;
    name:       string;
    stock:      number | null;
    lowStockThreshold: number;
    pricePaise: number | null;   // sale price
    costPaise:  number | null;   // purchase / cost price
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
        costPrice: p.costPaise  != null ? p.costPaise  / 100 : null,
        mrp:       p.mrpPaise   != null ? p.mrpPaise   / 100 : null,
    };
}

export function InvProductCombobox({ value, onChange, placeholder = "Search item…", className = "", autoFocus = false }: Props) {
    const [products, setProducts]   = useState<ProductOption[]>([]);
    const [query, setQuery]         = useState("");
    const [loading, setLoading]     = useState(true);

    // Load all products once (cached in memory for fast typing)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

    // Match dropdown width to the parent voucher table so it spans the row
    useEffect(() => {
        if (!cb.open) return;
        const wrapper = cb.wrapperRef.current;
        if (!wrapper) return;
        const table = wrapper.closest("table");
        if (!table) return;
        const measure = () => {
            const tableRect   = table.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();
            cb.setDropdownWidth(Math.max(360, tableRect.right - wrapperRect.left));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [cb.open, cb.wrapperRef, cb.setDropdownWidth, cb]);

    // Wrap handleKeyDown to add Tab commit-on-exit (consumer-specific).
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        cb.handleKeyDown(e);
    };

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

            {cb.open && (
                <div
                    className="absolute left-0 top-full z-50 mt-0.5 rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{ width: cb.dropdownWidth ?? 720 }}
                >
                    {/* Header row */}
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
                        <ScrollArea className="max-h-72 h-72">
                            <ul ref={cb.listRef} className="divide-y divide-border">
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
                                            {/* Cost price */}
                                            <span className="text-right text-xs tabular-nums text-muted-foreground self-center">
                                                {formatINR(p.costPaise)}
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
                        </ScrollArea>
                    )}
                </div>
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
