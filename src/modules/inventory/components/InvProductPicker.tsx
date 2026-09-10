"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchProducts } from "@/shared/lib/inventory";
import { useProductCatalog, loadProductCatalog } from "@/shared/hooks";

type InvProductOption = {
    id: number;
    sku: string;
    name: string;
    unit: { code: string };
    brand: { name: string } | null;
    codes?: { kind: string; value: string }[];
};

/** Rows listed at once — beyond this the operator narrows with a query. */
const MAX_ROWS = 50;

export function InvProductPicker({
    label = "Inventory SKU",
    value,
    onChange,
}: {
    label?: string;
    value: number | null;
    onChange: (id: number | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    // The shared IndexedDB-backed catalogue — the same array every other picker
    // on the page reads, kept fresh by delta sync + realtime. This dialog used
    // to pull the WHOLE catalogue over the network every single time it opened.
    // `eager: false` keeps that cost at zero until someone actually opens it.
    const { products } = useProductCatalog<InvProductOption>({ eager: false });
    useEffect(() => { if (open) void loadProductCatalog(); }, [open]);

    const selected = useMemo(() => {
        if (value == null) return null;
        return products.find((p) => p.id === value) ?? null;
    }, [value, products]);

    // Ranked by the same tiered search the till uses, and capped — the dialog
    // lists the catalogue when nothing is typed, so it must not mount thousands
    // of rows at once. No guess fallback: picking an item for a voucher line is
    // a deliberate choice, so an empty list is honest.
    const filtered = useMemo(
        () => (query.trim()
            ? searchProducts(products, query, { rows: MAX_ROWS }).rows
            : products.slice(0, MAX_ROWS)),
        [products, query],
    );

    const pick = (p: InvProductOption) => {
        onChange(p.id);
        setOpen(false);
        setQuery("");
    };

    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm min-h-9">
                    {selected
                        ? <span className="font-mono">{selected.sku}</span>
                        : <span className="text-muted-foreground">None</span>}
                    {selected ? <span className="ml-2 text-muted-foreground">{selected.name}</span> : null}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                    {selected ? "Change" : "Select"}
                </Button>
                {selected && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { onChange(null); }}
                        aria-label="Clear"
                    >
                        <X className="size-4" />
                    </Button>
                )}
            </div>

            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Select inventory product</DialogTitle>
                    </DialogHeader>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                            className="pl-9"
                            placeholder="Search SKU, name, or barcode…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-border border border-border rounded-md">
                        {filtered.length === 0 ? (
                            <p className="p-4 text-sm text-muted-foreground text-center">No products found.</p>
                        ) : (
                            filtered.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
                                    onClick={() => pick(p)}
                                >
                                    <span className="font-mono text-sm">{p.sku}</span>
                                    <span className="ml-3 text-sm">{p.name}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {p.unit.code}{p.brand ? ` · ${p.brand.name}` : ""}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
