"use client";

// BOM picker for the Manufacturing Journal form. Loads active BOMs once,
// presents a dialog with name + output product search, and hands the caller
// the hydrated payload (id, name, output product, output qty, lines).
//
// Modelled after InvProductPicker — same dialog + search rhythm.

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Search, X, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchProducts, productSearchText } from "@/shared/lib/inventory";

export type BomPickerPayload = {
    id:              number;
    name:            string;
    outputProductId: number;
    outputProduct:   { id: number; sku: string; name: string; unit: { code: string }; codes?: { kind: string; value: string }[] } | null;
    outputQty:       number;
    lines:           {
        productId: number;
        qty:       number;
        product?:  { id: number; sku: string; name: string; unit: { code: string } };
    }[];
};

type RawBom = BomPickerPayload & { isActive: boolean };

/** Rows listed at once — beyond this the operator narrows with a query. */
const MAX_ROWS = 50;

export function BomPicker({
    label = "Bill of Materials",
    value,
    onPick,
    onClear,
}: {
    label?: string;
    value: number | null;
    onPick: (bom: BomPickerPayload) => void;
    onClear: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [boms, setBoms] = useState<RawBom[]>([]);
    const [query, setQuery] = useState("");
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!open || loaded) return;
        axios
            .get<RawBom[]>("/api/inventory/boms?active=1")
            .then((r) => {
                // Coerce decimals → numbers (Prisma returns strings for Decimal).
                const norm = r.data.map((b) => ({
                    ...b,
                    outputQty: Number(b.outputQty),
                    lines: b.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
                }));
                setBoms(norm);
                setLoaded(true);
            })
            .catch(() => setBoms([]));
    }, [open, loaded]);

    const selected = useMemo(() => boms.find((b) => b.id === value) ?? null, [boms, value]);

    // Ranked by the same tiered search the product pickers use, over the BOM's
    // own name plus its output product's searchable text — so a BOM is findable
    // by what it makes, and a run-together query still lands.
    const filtered = useMemo(
        () => (query.trim()
            ? searchProducts(boms, query, {
                rows: MAX_ROWS,
                text: (b) => `${b.name} ${b.outputProduct ? productSearchText(b.outputProduct) : ""}`.toLowerCase(),
            }).rows
            : boms.slice(0, MAX_ROWS)),
        [boms, query],
    );

    const pick = (b: BomPickerPayload) => {
        onPick(b);
        setOpen(false);
        setQuery("");
    };

    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm min-h-9">
                    {selected ? (
                        <span>
                            <span className="font-medium">{selected.name}</span>
                            {selected.outputProduct && (
                                <span className="ml-2 text-muted-foreground text-xs">
                                    → {Number(selected.outputQty)} × {selected.outputProduct.name}
                                </span>
                            )}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">None — free entry</span>
                    )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                    <Workflow className="size-4" />
                    {selected ? "Change" : "Pick BOM"}
                </Button>
                {selected && (
                    <Button type="button" variant="ghost" size="sm" onClick={onClear} aria-label="Clear BOM">
                        <X className="size-4" />
                    </Button>
                )}
            </div>

            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Select Bill of Materials</DialogTitle>
                    </DialogHeader>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                            className="pl-9"
                            placeholder="Search BOM name or output product…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-border border border-border rounded-md">
                        {filtered.length === 0 ? (
                            <p className="p-4 text-sm text-muted-foreground text-center">
                                No active BOMs match. Create one under Inventory → Masters → BOMs.
                            </p>
                        ) : (
                            filtered.map((b) => (
                                <button
                                    key={b.id}
                                    type="button"
                                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
                                    onClick={() => pick(b)}
                                >
                                    <div className="font-medium">{b.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        Produces {Number(b.outputQty)} × {b.outputProduct?.name ?? "—"}
                                        {b.outputProduct?.unit && ` (${b.outputProduct.unit.code})`}
                                        {" · "}
                                        {b.lines.length} consumption line{b.lines.length === 1 ? "" : "s"}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
