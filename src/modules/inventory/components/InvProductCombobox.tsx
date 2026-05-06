"use client";

/**
 * InvProductCombobox — Tally-style inline product search.
 * Renders a plain text input; as the user types, a dropdown appears
 * directly below showing matching products with stock/price columns.
 * No dialog — everything is inline for fast entry.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
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

export function InvProductCombobox({ value, onChange, placeholder = "Search item…", className = "", autoFocus = false }: Props) {
    const [products, setProducts]   = useState<ProductOption[]>([]);
    const [query, setQuery]         = useState("");
    const [open, setOpen]           = useState(false);
    const [loading, setLoading]     = useState(true);
    const [highlighted, setHighlighted] = useState(0);
    const [dropdownWidth, setDropdownWidth] = useState<number | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef  = useRef<HTMLUListElement>(null);

    // Match dropdown width to the parent voucher table so it spans the row
    useEffect(() => {
        if (!open) return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const table = wrapper.closest("table");
        if (!table) return;
        const measure = () => {
            const tableRect   = table.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();
            setDropdownWidth(Math.max(360, tableRect.right - wrapperRect.left));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(syncQuery, [syncQuery]);

    const filtered = query.trim()
        ? products.filter((p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.sku.toLowerCase().includes(query.toLowerCase()) ||
            (p.barcode1 ?? "").includes(query)
          )
        : products;

    const pick = useCallback((p: ProductOption) => {
        setQuery(p.name);
        setOpen(false);
        onChange({
            id:        p.id,
            sku:       p.sku,
            name:      p.name,
            unitCode:  p.unit.code,
            stock:     p.stock,
            salePrice: p.pricePaise != null ? p.pricePaise / 100 : null,
            costPrice: p.costPaise  != null ? p.costPaise  / 100 : null,
            mrp:       p.mrpPaise   != null ? p.mrpPaise   / 100 : null,
        });
    }, [onChange]);

    const clear = useCallback(() => {
        setQuery("");
        setOpen(false);
        onChange(null);
        inputRef.current?.focus();
    }, [onChange]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open) { if (e.key !== "Escape") setOpen(true); return; }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[highlighted]) pick(filtered[highlighted]);
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    // Scroll highlighted item into view
    useEffect(() => {
        const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
        item?.scrollIntoView({ block: "nearest" });
    }, [highlighted]);

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
                    setHighlighted(0);
                    setOpen(true);
                    if (!e.target.value) onChange(null);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={handleKeyDown}
            />

            {open && (
                <div
                    className="absolute left-0 top-full z-50 mt-0.5 rounded-lg border border-border bg-popover shadow-xl text-sm"
                    style={{ width: dropdownWidth ?? 720 }}
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
                            <ul ref={listRef} className="divide-y divide-border">
                                {filtered.map((p, i) => {
                                    const isLow     = p.stock != null && p.stock <= p.lowStockThreshold;
                                    const stockZero = p.stock === 0;
                                    return (
                                        <li
                                            key={p.id}
                                            onMouseDown={() => pick(p)}
                                            onMouseEnter={() => setHighlighted(i)}
                                            className={`grid grid-cols-[minmax(0,1fr)_140px_140px_140px_100px] gap-x-3 cursor-pointer px-3 py-2 transition-colors ${
                                                i === highlighted ? "bg-accent" : "hover:bg-accent/60"
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
                    onMouseDown={clear}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground text-base leading-none pr-1"
                    tabIndex={-1}
                >
                    ×
                </button>
            )}
        </div>
    );
}
