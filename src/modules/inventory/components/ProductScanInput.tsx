"use client";

// Unified scan + typeahead input — same shape POS uses on the checkout
// screen. The cashier can either:
//   • Scan a barcode (rapid keystrokes + Enter) → the query narrows to one
//     match and Enter selects it.
//   • Type a partial SKU / name / barcode / EAN / UPC → a dropdown of up
//     to 8 matches appears; arrow keys navigate; Enter selects the
//     highlighted row.
//
// The full product list is loaded once on mount (`GET /api/inventory/products/lookup`)
// and filtered client-side — keeps every keystroke instant, no per-key
// network roundtrip.
//
// After selection the input clears, the dropdown closes, and focus stays
// on the input so the operator can scan the next item.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ScanBarcode } from "lucide-react";

export type ScannedProduct = {
    id:        number;
    sku:       string;
    name:      string;
    stock:     number | null;
    /** Last purchase / cost price in paise — used to seed line rate on
     *  manufacturing-style vouchers so consumption/production carry the
     *  product's cost basis. null when no cost is tracked yet. */
    costPaise: number | null;
    unit:      { code: string } | null;
};

type Option = ScannedProduct & {
    barcode1?: string | null;
    barcode2?: string | null;
    barcode3?: string | null;
    ean1?:     string | null;
    ean2?:     string | null;
    ean3?:     string | null;
    upc1?:     string | null;
    upc2?:     string | null;
    upc3?:     string | null;
};

const MAX_RESULTS = 8;

export function ProductScanInput({
    placeholder = "Scan or type SKU / barcode / name…",
    onScan,
    autoFocus = true,
    disabled = false,
}: {
    placeholder?: string;
    onScan: (product: ScannedProduct) => void;
    autoFocus?: boolean;
    disabled?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [products, setProducts] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    // "Browse mode" — operator hit Space in an empty input to see the full
    // catalogue without a query. Resets the moment they start typing or pick.
    const [browseAll, setBrowseAll] = useState(false);

    // Preload all active products (same pattern POS uses). The lookup
    // endpoint without ?code= returns the full list with all barcode /
    // EAN / UPC columns so we can match scan codes client-side.
    useEffect(() => {
        let cancelled = false;
        axios.get<Option[]>("/api/inventory/products/lookup")
            .then((r) => { if (!cancelled) setProducts(r.data); })
            .catch(() => { /* leave empty */ })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const matches = useMemo<Option[]>(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            // Empty query: browse mode lists EVERY active product (Tally-
            // style "End of List"). The dropdown is scroll-capped, so a
            // large catalogue is fine — the operator scrolls instead of
            // remembering the spelling.
            if (browseAll) {
                return [...products].sort((a, b) => a.name.localeCompare(b.name));
            }
            return [];
        }
        return products
            .filter((p) => {
                if (p.sku.toLowerCase() === q) return true;       // exact SKU/barcode hits win
                if (p.sku.toLowerCase().includes(q)) return true;
                if (p.name.toLowerCase().includes(q)) return true;
                // barcode / EAN / UPC columns — exact match only (these
                // are scan codes, not human-typed identifiers).
                const codes = [
                    p.barcode1, p.barcode2, p.barcode3,
                    p.ean1, p.ean2, p.ean3,
                    p.upc1, p.upc2, p.upc3,
                ];
                return codes.some((c) => c && c.toLowerCase() === q);
            })
            // Stable sort: exact SKU/barcode matches first, then prefix matches on SKU, then everything else.
            .sort((a, b) => {
                const aExact = a.sku.toLowerCase() === q ? 0 : 1;
                const bExact = b.sku.toLowerCase() === q ? 0 : 1;
                if (aExact !== bExact) return aExact - bExact;
                const aPrefix = a.sku.toLowerCase().startsWith(q) ? 0 : 1;
                const bPrefix = b.sku.toLowerCase().startsWith(q) ? 0 : 1;
                if (aPrefix !== bPrefix) return aPrefix - bPrefix;
                return a.name.localeCompare(b.name);
            })
            .slice(0, MAX_RESULTS);
    }, [query, products, browseAll]);

    // Close dropdown on outside click.
    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (!wrapperRef.current) return;
            if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    const pick = useCallback((p: Option) => {
        onScan({ id: p.id, sku: p.sku, name: p.name, stock: p.stock, costPaise: p.costPaise ?? null, unit: p.unit });
        setQuery("");
        setOpen(false);
        setHighlighted(0);
        setBrowseAll(false);
        inputRef.current?.focus();
    }, [onScan]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Space or Backspace in an empty input → open the full catalogue
        // dropdown (Tally-style "End of List" affordance). Helpful when
        // the operator forgets the exact spelling and wants to scroll.
        // Suppress the character so the query stays empty.
        if ((e.key === " " || e.key === "Backspace") && query === "") {
            e.preventDefault();
            setBrowseAll(true);
            setOpen(true);
            setHighlighted(0);
            return;
        }
        if (e.key === "Escape") { setQuery(""); setBrowseAll(false); setOpen(false); return; }
        if (matches.length === 0) {
            if (e.key === "Enter" && query.trim()) {
                // No client-side match — maybe a brand-new scan code not
                // yet loaded in memory. Ask the server.
                e.preventDefault();
                const code = query.trim();
                axios.get<ScannedProduct | null>("/api/inventory/products/lookup", { params: { code } })
                    .then((r) => {
                        if (r.data) {
                            pick({ ...r.data, costPaise: r.data.costPaise ?? null, barcode1: null });
                        } else {
                            toast.error(`No product matches "${code}"`);
                            inputRef.current?.select();
                        }
                    })
                    .catch(() => toast.error("Lookup failed"));
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((i) => Math.min(i + 1, matches.length - 1));
            setOpen(true);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((i) => Math.max(i - 1, 0));
            setOpen(true);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const target = matches[highlighted] ?? matches[0];
            if (target) pick(target);
        }
    };

    return (
        <div ref={wrapperRef} className="relative">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground pointer-events-none" />
            <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder={loading ? "Loading products…" : placeholder}
                autoFocus={autoFocus}
                disabled={disabled || loading}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted(0);
                    setOpen(true);
                    if (e.target.value !== "") setBrowseAll(false);
                }}
                onFocus={() => { if (query.trim()) setOpen(true); }}
                onKeyDown={onKeyDown}
                className="w-full rounded-md border-2 border-primary/40 bg-background pl-10 pr-10 py-2.5 text-base outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
            />

            {open && matches.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg text-sm">
                    {matches.map((p, i) => (
                        <li
                            key={p.id}
                            onMouseEnter={() => setHighlighted(i)}
                            onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                            className={`cursor-pointer px-3 py-2 ${i === highlighted ? "bg-accent" : "hover:bg-accent/60"}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-medium truncate">{p.name}</span>
                                <span className="text-xs text-muted-foreground font-mono shrink-0">
                                    {p.stock == null ? "" : `stock ${p.stock}`}
                                </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate">
                                {p.sku}{p.unit ? ` · ${p.unit.code}` : ""}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
