"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { invalidateProductCatalog, useProductCatalog } from "@/shared/hooks/useProductCatalog";
import { searchProducts } from "@/shared/lib/inventory/productSearch";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import MobileListScreen from "./MobileListScreen";

/** The catalogue row fields this screen reads (the POS lookup row carries more). */
type CatalogueRow = {
    id: number;
    name: string;
    sku: string | null;
    isActive?: boolean;
    stock: number | null;
    effectiveSalePricePaise: number | null;
    mrpPaise: number | null;
    unit?: { code: string } | null;
    codes?: { kind: string; value: string }[];
};
type Split = { total: number; branches: { branchId: string; name: string; qty: number }[] };

const PAGE = 30;

const qty = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }));

/**
 * Stock & price over the product catalogue the device already holds — the POS
 * catalogue in the shared Dexie database (useProductCatalog: one full download,
 * then only what changed, kept live by the stock / catalogue change signals).
 * Searching asks the server nothing, works offline, and finds what the till's
 * search finds (name, SKU, any barcode, typos). Tapping a row asks for its
 * per-branch split, the one figure the catalogue does not carry.
 *
 * Shown: name, SKU, on-hand, sale price, MRP. Never cost — the catalogue row
 * carries one for the POS, but this screen does not read it.
 */
export default function MobileStock() {
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE);
    const { products, loading } = useProductCatalog<CatalogueRow>();
    const [open, setOpen] = useState<number | null>(null);
    const [splits, setSplits] = useState<Record<number, Split | string>>({});

    const { shown, more } = useMemo(() => {
        const live = products.filter((p) => p.isActive !== false);
        const q = query.trim();
        const rows = q
            ? searchProducts(live, q, { rows: limit + 1 }).rows
            : [...live].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit + 1);
        return { shown: rows.slice(0, limit), more: rows.length > limit };
    }, [products, query, limit]);

    const toggle = async (id: number) => {
        const closing = open === id;
        setOpen(closing ? null : id);
        if (closing || (splits[id] && typeof splits[id] !== "string")) return;
        try {
            const { data } = await axios.get<Split>(`/api/mobile/stock/${id}`);
            setSplits((was) => ({ ...was, [id]: data }));
        } catch (e) {
            setSplits((was) => ({ ...was, [id]: extractApiError(e, "Could not load branch stock") }));
        }
    };

    return (
        <MobileListScreen
            title="Stock & price"
            placeholder="Product name, SKU or barcode"
            query={query}
            onQuery={(q) => { setQuery(q); setLimit(PAGE); }}
            scan
            list={{
                loading,
                error: null,
                hasMore: more,
                empty: shown.length === 0,
                loadMore: () => setLimit((n) => n + PAGE),
                refresh: () => { setSplits({}); void invalidateProductCatalog(); },
            }}
            emptyText={loading ? "Loading products…" : "No products found."}
        >
            {shown.map((p) => {
                const split = splits[p.id];
                const out = (p.stock ?? 0) <= 0;
                return (
                    <li key={p.id}>
                        <button type="button" onClick={() => void toggle(p.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left active:bg-muted">
                            <div className="min-w-0 flex-1">
                                <p className="font-medium leading-snug">{p.name}</p>
                                {p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="font-semibold">{p.effectiveSalePricePaise == null ? "—" : formatRupeesFromPaise(p.effectiveSalePricePaise)}</p>
                                <p className={`text-sm ${out ? "text-destructive" : "text-muted-foreground"}`}>
                                    {qty(p.stock)} {p.unit?.code ?? ""} in stock
                                </p>
                            </div>
                        </button>
                        {open === p.id && (
                            <div className="bg-muted/40 px-3 pb-3 text-sm">
                                {split == null ? (
                                    <p className="text-muted-foreground">Loading branches…</p>
                                ) : typeof split === "string" ? (
                                    <p className="text-destructive">{split}</p>
                                ) : split.branches.length === 0 ? (
                                    <p className="text-muted-foreground">No branch stock recorded.</p>
                                ) : (
                                    <table className="w-full">
                                        <tbody>
                                            {split.branches.map((b) => (
                                                <tr key={b.branchId}>
                                                    <td className="py-1">{b.name}</td>
                                                    <td className="py-1 text-right tabular-nums">{qty(b.qty)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                {p.mrpPaise != null && <p className="mt-1 text-xs text-muted-foreground">MRP {formatRupeesFromPaise(p.mrpPaise)}</p>}
                            </div>
                        )}
                    </li>
                );
            })}
        </MobileListScreen>
    );
}
