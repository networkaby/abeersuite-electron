"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InvProductOption = {
    id: number;
    sku: string;
    name: string;
    unit: { code: string };
    brand: { name: string } | null;
};

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
    const [products, setProducts] = useState<InvProductOption[]>([]);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<InvProductOption | null>(null);

    useEffect(() => {
        if (!open) return;
        axios
            .get<InvProductOption[]>("/api/inventory/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, [open]);

    useEffect(() => {
        if (value == null) { setSelected(null); return; }
        if (products.length > 0) {
            setSelected(products.find((p) => p.id === value) ?? null);
        }
    }, [value, products]);

    const filtered = query.trim()
        ? products.filter(
              (p) =>
                  p.sku.toLowerCase().includes(query.toLowerCase()) ||
                  p.name.toLowerCase().includes(query.toLowerCase())
          )
        : products;

    const pick = (p: InvProductOption) => {
        setSelected(p);
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
                        onClick={() => { setSelected(null); onChange(null); }}
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
                            placeholder="Search SKU or name…"
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
